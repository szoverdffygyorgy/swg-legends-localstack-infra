/**
 * Lambda handler: API -- Get History
 *
 * Serves one endpoint via API Gateway REST API (v1):
 *
 *   GET /history    -- list despawned (past) resources with optional filters
 *
 * Query parameters:
 *   ?class=Copper           -- filter by class hierarchy (uses by-category GSI)
 *                              Matches the class itself AND all subclasses.
 *   ?stat=oq&min=800        -- filter by stat threshold
 *   ?name=Uekayi            -- search by resource name (case-insensitive contains)
 *   (no params)             -- scan all history
 *
 * The class filter performs a hierarchical lookup identical to api-get-resources:
 * it finds the class node in the resource-classes table, gets its treePath, and
 * queries the by-category GSI with begins_with to match all descendants.
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT       -- LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM         -- AWS region
 *   RESOURCE_HISTORY_TABLE    -- DynamoDB table name for historical resources
 *   RESOURCE_CLASSES_TABLE    -- DynamoDB table name for class hierarchy
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
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

interface HistoryItem {
  resourceId: string;
  despawnedAt: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
  availableTimestamp: number;
  availableBy: string;
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
const tableName = process.env.RESOURCE_HISTORY_TABLE || "resource-history";
const classesTableName = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Classification cache ────────────────────────────────────────────
// Loaded on cold start, cached across invocations.

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

// ─── Query functions ─────────────────────────────────────────────────

/**
 * Check if a class name corresponds to a leaf node (no children).
 */
function isLeafNode(className: string, cache: Map<string, ClassInfo>): boolean {
  const info = cache.get(className);
  if (!info) return true;

  const prefix = info.treePath + "/";
  for (const [, node] of cache) {
    if (node.treePath.startsWith(prefix)) return false;
  }
  return true;
}

/**
 * Query history by class hierarchy using the by-category GSI.
 * Same three-tier strategy as api-get-resources:
 *   - Root category: get all in category
 *   - Branch node: begins_with on classPath prefix
 *   - Leaf node: exact classPath match
 */
async function queryByClass(
  resourceClass: string,
  filterStat?: string,
  minValue?: number,
  nameFilter?: string,
  cache?: Map<string, ClassInfo>
): Promise<HistoryItem[]> {
  if (cache) {
    const classInfo = cache.get(resourceClass);
    if (classInfo) {
      const segments = classInfo.treePath.split("/");
      let category: string | undefined;
      for (const [, node] of cache) {
        if (node.depth === 0 && node.treePath === segments[0]) {
          category = node.className;
          break;
        }
      }

      if (category) {
        const expressionValues: Record<string, unknown> = { ":cat": category };
        const expressionNames: Record<string, string> = {};
        const filterParts: string[] = [];
        const input: QueryCommandInput = {
          TableName: tableName,
          IndexName: "by-category",
          ExpressionAttributeValues: expressionValues,
        };

        if (classInfo.depth === 0) {
          input.KeyConditionExpression = "classCategory = :cat";
        } else if (!isLeafNode(resourceClass, cache)) {
          input.KeyConditionExpression = "classCategory = :cat AND begins_with(classPath, :prefix)";
          expressionValues[":prefix"] = classInfo.treePath + "/";
        } else {
          input.KeyConditionExpression = "classCategory = :cat AND classPath = :exact";
          expressionValues[":exact"] = classInfo.treePath;
        }

        if (filterStat && minValue !== undefined) {
          filterParts.push("#stat >= :minVal");
          expressionNames["#stat"] = filterStat;
          expressionValues[":minVal"] = minValue;
        }

        if (nameFilter) {
          filterParts.push("contains(#rn, :nameFilter)");
          expressionNames["#rn"] = "resourceName";
          expressionValues[":nameFilter"] = nameFilter;
        }

        if (filterParts.length > 0) {
          input.FilterExpression = filterParts.join(" AND ");
        }
        if (Object.keys(expressionNames).length > 0) {
          input.ExpressionAttributeNames = expressionNames;
        }

        const items: HistoryItem[] = [];
        let lastKey: Record<string, unknown> | undefined;

        do {
          if (lastKey) input.ExclusiveStartKey = lastKey;
          const result = await docClient.send(new QueryCommand(input));
          items.push(...((result.Items ?? []) as HistoryItem[]));
          lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        return items;
      }
    }
  }

  // Fallback: scan with filter for unrecognized class names
  console.warn(`Class "${resourceClass}" not found in hierarchy, falling back to scan`);
  const expressionValues: Record<string, unknown> = { ":cls": resourceClass };
  const expressionNames: Record<string, string> = {};
  const filterParts: string[] = ["resourceClass = :cls"];

  if (filterStat && minValue !== undefined) {
    filterParts.push("#stat >= :minVal");
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  if (nameFilter) {
    filterParts.push("contains(#rn, :nameFilter)");
    expressionNames["#rn"] = "resourceName";
    expressionValues[":nameFilter"] = nameFilter;
  }

  const fallbackInput: ScanCommandInput = {
    TableName: tableName,
    FilterExpression: filterParts.join(" AND "),
    ExpressionAttributeValues: expressionValues,
  };

  if (Object.keys(expressionNames).length > 0) {
    fallbackInput.ExpressionAttributeNames = expressionNames;
  }

  const result = await docClient.send(new ScanCommand(fallbackInput));
  return (result.Items ?? []) as HistoryItem[];
}

/**
 * Scan all history with optional stat and name filters.
 */
async function scanAll(
  filterStat?: string,
  minValue?: number,
  nameFilter?: string
): Promise<HistoryItem[]> {
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};
  const filterParts: string[] = [];
  const input: ScanCommandInput = { TableName: tableName };

  if (filterStat && minValue !== undefined) {
    filterParts.push("#stat >= :minVal");
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  if (nameFilter) {
    filterParts.push("contains(#rn, :nameFilter)");
    expressionNames["#rn"] = "resourceName";
    expressionValues[":nameFilter"] = nameFilter;
  }

  if (filterParts.length > 0) {
    input.FilterExpression = filterParts.join(" AND ");
  }
  if (Object.keys(expressionValues).length > 0) {
    input.ExpressionAttributeValues = expressionValues;
  }
  if (Object.keys(expressionNames).length > 0) {
    input.ExpressionAttributeNames = expressionNames;
  }

  const items: HistoryItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    if (lastKey) input.ExclusiveStartKey = lastKey;
    const result = await docClient.send(new ScanCommand(input));
    items.push(...((result.Items ?? []) as HistoryItem[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const params = event.queryStringParameters ?? {};

  console.log(`API: ${method} ${path}`, JSON.stringify(params));

  // Load classification cache (cached across invocations)
  const cache = await loadClassCache();

  try {
    const { class: resourceClass, stat, min, name: nameFilter } = params;

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

    if (minValue !== undefined && !stat) {
      return jsonResponse(400, { error: "min requires stat parameter" });
    }

    let items: HistoryItem[];

    if (resourceClass) {
      items = await queryByClass(resourceClass, stat, minValue, nameFilter, cache);
    } else {
      items = await scanAll(stat, minValue, nameFilter);
    }

    // Sort by despawnedAt descending (most recent first)
    items.sort((a, b) => b.despawnedAt.localeCompare(a.despawnedAt));

    return jsonResponse(200, {
      count: items.length,
      filters: {
        ...(resourceClass && { class: resourceClass }),
        ...(stat && { stat, min: minValue }),
        ...(nameFilter && { name: nameFilter }),
      },
      resources: items,
    });
  } catch (err) {
    console.error("Error handling request:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
