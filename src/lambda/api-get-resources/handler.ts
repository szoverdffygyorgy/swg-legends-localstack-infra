/**
 * Lambda handler: API -- Get Resources
 *
 * Serves two endpoints via API Gateway REST API (v1):
 *
 *   GET /resources          -- list current resources with optional filters
 *   GET /resources/{id}     -- get a specific resource by ID (all planets)
 *
 * Query parameters for GET /resources:
 *   ?planet=Tatooine        -- filter by planet  (uses by-planet GSI)
 *   ?class=Copper           -- filter by class hierarchy (uses by-category GSI)
 *                              Matches the class itself AND all subclasses.
 *                              e.g., ?class=Copper returns Desh Copper, Polysteel Copper, etc.
 *   ?stat=oq&min=800        -- filter by stat threshold
 *   (no params)             -- scan all resources
 *
 * The class filter performs a hierarchical lookup: it finds the class node
 * in the resource-classes table, gets its treePath, and queries the
 * by-category GSI with begins_with to match all descendants.
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT       -- LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM         -- AWS region
 *   RESOURCES_TABLE           -- DynamoDB table name for current resources
 *   RESOURCE_CLASSES_TABLE    -- DynamoDB table name for class hierarchy
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, ScanCommandInput } from "@aws-sdk/lib-dynamodb";

// ─── Types ───────────────────────────────────────────────────────────

interface APIGatewayProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
  isBase64Encoded: boolean;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface ResourceItem {
  resourceId: string;
  planet: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  allPlanets: string;
  availableTimestamp: number;
  availableBy: string;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
  er?: number;
  cr?: number;
  cd?: number;
  dr?: number;
  fl?: number;
  hr?: number;
  ma?: number;
  pe?: number;
  oq?: number;
  sr?: number;
  ut?: number;
}

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

const VALID_STATS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.RESOURCES_TABLE || "resources";
const classesTableName = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Classification cache ────────────────────────────────────────────
// Loaded on cold start, cached across invocations.
// Maps className (e.g., "Copper") -> { treePath, className, depth }

let classCache: Map<string, ClassInfo> | null = null;

async function loadClassCache(): Promise<Map<string, ClassInfo>> {
  if (classCache) return classCache;

  console.log(`Loading classification cache from ${classesTableName}...`);
  const cache = new Map<string, ClassInfo>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: classesTableName,
        ProjectionExpression: "className, treePath, #d",
        ExpressionAttributeNames: { "#d": "depth" },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      cache.set(item.className as string, {
        treePath: item.treePath as string,
        className: item.className as string,
        depth: item.depth as number,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`Classification cache loaded: ${cache.size} classes`);
  classCache = cache;
  return cache;
}

// ─── CORS headers ────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

// ─── JSON response helper ────────────────────────────────────────────

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Convert a class name to a slugified ID (matching the scrape script's logic).
 * "Desh Copper" -> "desh_copper"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─── Query functions ─────────────────────────────────────────────────

async function queryByPlanet(
  planet: string,
  filterStat?: string,
  minValue?: number
): Promise<ResourceItem[]> {
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const expressionNames: Record<string, string> = {};
  const input: QueryCommandInput = {
    TableName: tableName,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  if (Object.keys(expressionNames).length > 0) {
    input.ExpressionAttributeNames = expressionNames;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

/**
 * Query resources by planet AND class hierarchy.
 * Queries the by-planet GSI, then adds a FilterExpression for the class
 * hierarchy using begins_with on classPath.
 *
 * This handles the combined case where both ?planet= and ?class= are
 * provided (e.g., "all Metals on Tatooine").
 */
async function queryByPlanetAndClass(
  planet: string,
  resourceClass: string,
  filterStat?: string,
  minValue?: number,
  cache?: Map<string, ClassInfo>
): Promise<ResourceItem[]> {
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const expressionNames: Record<string, string> = {};
  const filterParts: string[] = [];

  // Build class hierarchy filter
  if (cache) {
    const classInfo = cache.get(resourceClass);
    if (classInfo) {
      if (classInfo.depth === 0) {
        // Root category: filter by classCategory
        filterParts.push("classCategory = :classCategory");
        expressionValues[":classCategory"] = classInfo.className;
      } else if (!isLeafNode(resourceClass, cache)) {
        // Branch node: filter by classPath prefix
        filterParts.push("begins_with(classPath, :classPrefix)");
        expressionValues[":classPrefix"] = classInfo.treePath + "/";
      } else {
        // Leaf node: exact match on classPath
        filterParts.push("classPath = :classPath");
        expressionValues[":classPath"] = classInfo.treePath;
      }
    } else {
      // Fallback: exact match on resourceClass string
      filterParts.push("resourceClass = :cls");
      expressionValues[":cls"] = resourceClass;
    }
  } else {
    filterParts.push("resourceClass = :cls");
    expressionValues[":cls"] = resourceClass;
  }

  // Add stat filter
  if (filterStat && minValue !== undefined) {
    filterParts.push("#stat >= :minVal");
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  const input: QueryCommandInput = {
    TableName: tableName,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterParts.length > 0) {
    input.FilterExpression = filterParts.join(" AND ");
  }
  if (Object.keys(expressionNames).length > 0) {
    input.ExpressionAttributeNames = expressionNames;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

/**
 * Query resources by class hierarchy using the by-category GSI.
 * Looks up the class in the hierarchy to find its treePath and category,
 * then queries with begins_with to match all descendants.
 *
 * Falls back to exact match on by-class GSI if the class isn't found
 * in the hierarchy (backward compatibility).
 */
async function queryByClass(
  resourceClass: string,
  filterStat?: string,
  minValue?: number,
  cache?: Map<string, ClassInfo>
): Promise<ResourceItem[]> {
  // Try hierarchical query first
  if (cache) {
    const classInfo = cache.get(resourceClass);
    if (classInfo) {
      // Find the category (root ancestor) from the treePath
      const segments = classInfo.treePath.split("/");
      let category: string | undefined;
      for (const [, node] of cache) {
        if (node.depth === 0 && node.treePath === segments[0]) {
          category = node.className;
          break;
        }
      }

      if (category) {
        const input: QueryCommandInput = {
          TableName: tableName,
          IndexName: "by-category",
          ExpressionAttributeValues: { ":cat": category },
        };

        if (classInfo.depth === 0) {
          // Root category: get everything in this category
          input.KeyConditionExpression = "classCategory = :cat";
        } else if (!isLeafNode(resourceClass, cache)) {
          // Branch node: get all descendants
          // Append "/" so "copper" doesn't match "copper_something" at the same level
          input.KeyConditionExpression = "classCategory = :cat AND begins_with(classPath, :prefix)";
          (input.ExpressionAttributeValues as Record<string, unknown>)[":prefix"] = classInfo.treePath + "/";
        } else {
          // Leaf node: exact match on classPath
          input.KeyConditionExpression = "classCategory = :cat AND classPath = :exact";
          (input.ExpressionAttributeValues as Record<string, unknown>)[":exact"] = classInfo.treePath;
        }

        if (filterStat && minValue !== undefined) {
          input.FilterExpression = "#stat >= :minVal";
          input.ExpressionAttributeNames = { "#stat": filterStat };
          (input.ExpressionAttributeValues as Record<string, unknown>)[":minVal"] = minValue;
        }

        const result = await docClient.send(new QueryCommand(input));
        return (result.Items ?? []) as ResourceItem[];
      }
    }
  }

  // Fallback: exact match on by-class GSI (legacy behavior)
  const expressionValues: Record<string, unknown> = { ":cls": resourceClass };
  const input: QueryCommandInput = {
    TableName: tableName,
    IndexName: "by-class",
    KeyConditionExpression: "resourceClass = :cls",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
    input.ExpressionAttributeNames = { "#stat": filterStat };
    expressionValues[":minVal"] = minValue;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

/**
 * Check if a class name corresponds to a leaf node (no children).
 */
function isLeafNode(className: string, cache: Map<string, ClassInfo>): boolean {
  const info = cache.get(className);
  if (!info) return true; // assume leaf if unknown

  // Check if any other node's path starts with this node's path + "/"
  const prefix = info.treePath + "/";
  for (const [, node] of cache) {
    if (node.treePath.startsWith(prefix)) return false;
  }
  return true;
}

async function queryById(resourceId: string): Promise<ResourceItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "resourceId = :id",
      ExpressionAttributeValues: { ":id": resourceId },
    })
  );
  return (result.Items ?? []) as ResourceItem[];
}

async function scanAll(
  filterStat?: string,
  minValue?: number
): Promise<ResourceItem[]> {
  const input: ScanCommandInput = { TableName: tableName };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
    input.ExpressionAttributeNames = { "#stat": filterStat };
    input.ExpressionAttributeValues = { ":minVal": minValue };
  }

  const result = await docClient.send(new ScanCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const params = event.queryStringParameters ?? {};
  const pathParams = event.pathParameters ?? {};

  console.log(`API: ${method} ${path}`, JSON.stringify(params));

  // Load classification cache (cached across invocations)
  const cache = await loadClassCache();

  try {
    // GET /resources/{id} -- specific resource by ID
    if (pathParams.id) {
      const items = await queryById(pathParams.id);
      if (items.length === 0) {
        return jsonResponse(404, {
          error: "Resource not found",
          resourceId: pathParams.id,
        });
      }
      // Return a single object with all planets as an array
      const first = items[0];
      return jsonResponse(200, {
        resourceId: first.resourceId,
        resourceName: first.resourceName,
        resourceClass: first.resourceClass,
        resourceClassId: first.resourceClassId,
        planets: items.map((i) => i.planet),
        availableTimestamp: first.availableTimestamp,
        availableBy: first.availableBy,
        classPath: first.classPath,
        classCategory: first.classCategory,
        classGroup: first.classGroup,
        stats: Object.fromEntries(
          VALID_STATS
            .filter((s) => (first as Record<string, unknown>)[s] !== undefined)
            .map((s) => [s, (first as Record<string, unknown>)[s]])
        ),
      });
    }

    // GET /resources -- list with filters
    const { planet, class: resourceClass, stat, min } = params;

    // Validate stat filter
    if (stat && !VALID_STATS.includes(stat)) {
      return jsonResponse(400, {
        error: `Invalid stat: "${stat}". Valid stats: ${VALID_STATS.join(", ")}`,
      });
    }

    const minValue = min ? Number(min) : undefined;
    if (min && isNaN(minValue!)) {
      return jsonResponse(400, { error: `Invalid min value: "${min}"` });
    }

    // Validate: min requires stat
    if (minValue !== undefined && !stat) {
      return jsonResponse(400, { error: "min requires stat parameter" });
    }

    let items: ResourceItem[];

    if (planet && resourceClass) {
      items = await queryByPlanetAndClass(planet, resourceClass, stat, minValue, cache);
    } else if (planet) {
      items = await queryByPlanet(planet, stat, minValue);
    } else if (resourceClass) {
      items = await queryByClass(resourceClass, stat, minValue, cache);
    } else {
      items = await scanAll(stat, minValue);
    }

    return jsonResponse(200, {
      count: items.length,
      filters: {
        ...(planet && { planet }),
        ...(resourceClass && { class: resourceClass }),
        ...(stat && { stat, min: minValue }),
      },
      resources: items,
    });
  } catch (err) {
    console.error("Error handling request:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
