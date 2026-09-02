/**
 * Lambda handler: API -- Get Schematics
 *
 * Serves two endpoints via API Gateway REST API (v1):
 *
 *   GET /schematics          -- list/search schematics with filters
 *   GET /schematics/{id}     -- get a specific schematic by ID
 *
 * Query parameters for GET /schematics:
 *   ?class=Metal             -- find schematics that use this resource class
 *                               Uses the CLASS# ingredient index in the schematics table.
 *                               With ?hierarchy=true, also queries all ancestor classes.
 *   ?name=Lightsaber         -- search schematics by name substring (scan + filter)
 *   ?category=767            -- browse by category (uses by-category GSI)
 *   ?base=nge                -- filter by game version (nge or precu)
 *
 * The ?class + ?hierarchy=true combination supports the Resource Profile
 * "Used In Schematics" feature: given a resource's class (e.g., "Desh Copper"),
 * walk up the hierarchy (Copper -> Non-Ferrous Metal -> Metal -> Mineral) and
 * return all schematics that require any of those classes.
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT       -- LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM         -- AWS region
 *   SCHEMATICS_TABLE          -- DynamoDB table name for schematics
 *   RESOURCE_CLASSES_TABLE    -- DynamoDB table name for class hierarchy
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

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

interface ClassInfo {
  treePath: string;
  className: string;
  parentName: string | null;
  depth: number;
}

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.SCHEMATICS_TABLE || "schematics";
const classesTableName = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Classification cache ────────────────────────────────────────────

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
        ProjectionExpression: "className, parentName, treePath, #d",
        ExpressionAttributeNames: { "#d": "depth" },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      cache.set(item.className as string, {
        treePath: item.treePath as string,
        className: item.className as string,
        parentName: (item.parentName as string) ?? null,
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

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// ─── Get ancestors of a class ────────────────────────────────────────

function getAncestorClasses(className: string, cache: Map<string, ClassInfo>): string[] {
  const ancestors: string[] = [className];
  let current = cache.get(className);

  while (current?.parentName) {
    ancestors.push(current.parentName);
    current = cache.get(current.parentName);
  }

  return ancestors;
}

// ─── Query: schematics by resource class ─────────────────────────────

async function queryByClass(
  className: string,
  hierarchy: boolean,
  baseFilter?: string
): Promise<Record<string, unknown>[]> {
  const classNames = hierarchy
    ? getAncestorClasses(className, await loadClassCache())
    : [className];

  // Query CLASS#{name} for each class in the hierarchy
  const allItems: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  for (const cls of classNames) {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": `CLASS#${cls}` },
          ExclusiveStartKey: lastKey,
        })
      );

      for (const item of result.Items ?? []) {
        const id = item.schematicId as string;
        if (!seenIds.has(id)) {
          if (!baseFilter || item.base === baseFilter) {
            seenIds.add(id);
            allItems.push({
              schematicId: item.schematicId,
              name: item.schematicName,
              base: item.base,
              category: item.category,
              matchedClass: cls,
              quality: item.quality,
              experimentalGroups: item.experimentalGroups,
            });
          }
        }
      }

      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
  }

  return allItems;
}

// ─── Query: schematics by name ───────────────────────────────────────

async function queryByName(
  name: string,
  baseFilter?: string
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  const filterParts = ["begins_with(pk, :prefix)", "contains(#n, :name)"];
  const exprValues: Record<string, unknown> = { ":prefix": "SCHEM#", ":name": name };

  if (baseFilter) {
    filterParts.push("base = :base");
    exprValues[":base"] = baseFilter;
  }

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: filterParts.join(" AND "),
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: exprValues,
        ProjectionExpression: "schematicId, #n, base, category, quality, complexity",
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

// ─── Query: schematics by category ───────────────────────────────────

async function queryByCategory(
  category: string,
  baseFilter?: string
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  const exprValues: Record<string, unknown> = { ":cat": category };
  let filterExpr: string | undefined;

  if (baseFilter) {
    filterExpr = "base = :base";
    exprValues[":base"] = baseFilter;
  }

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "by-category",
        KeyConditionExpression: "category = :cat",
        FilterExpression: filterExpr,
        ExpressionAttributeValues: exprValues,
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

// ─── Get single schematic ────────────────────────────────────────────

async function getSchematicById(id: string): Promise<Record<string, unknown> | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: { ":pk": `SCHEM#${id}`, ":sk": "META" },
    })
  );

  return result.Items?.[0] ?? null;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // OPTIONS (CORS preflight)
    if (event.httpMethod === "OPTIONS") {
      return jsonResponse(200, {});
    }

    const pathId = event.pathParameters?.id;
    const params = event.queryStringParameters ?? {};

    // GET /schematics/{id}
    if (pathId) {
      const schematic = await getSchematicById(pathId);
      if (!schematic) {
        return jsonResponse(404, { error: `Schematic ${pathId} not found` });
      }
      return jsonResponse(200, schematic);
    }

    // GET /schematics?class=...&hierarchy=true
    const className = params.class;
    const hierarchy = params.hierarchy === "true";
    const baseFilter = params.base;
    const name = params.name;
    const category = params.category;

    if (className) {
      const items = await queryByClass(className, hierarchy, baseFilter);
      return jsonResponse(200, {
        count: items.length,
        filters: { class: className, hierarchy, base: baseFilter },
        schematics: items,
      });
    }

    // GET /schematics?name=...
    if (name) {
      const items = await queryByName(name, baseFilter);
      return jsonResponse(200, {
        count: items.length,
        filters: { name, base: baseFilter },
        schematics: items,
      });
    }

    // GET /schematics?category=...
    if (category) {
      const items = await queryByCategory(category, baseFilter);
      return jsonResponse(200, {
        count: items.length,
        filters: { category, base: baseFilter },
        schematics: items,
      });
    }

    // No filters -- return usage help
    return jsonResponse(200, {
      message: "Use ?class=, ?name=, or ?category= to query schematics",
      endpoints: {
        "GET /schematics?class=Metal": "Find schematics using Metal",
        "GET /schematics?class=Copper&hierarchy=true": "Find schematics using Copper or any ancestor class",
        "GET /schematics?name=Lightsaber": "Search by name",
        "GET /schematics?category=767": "Browse by category",
        "GET /schematics/{id}": "Get specific schematic",
      },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
