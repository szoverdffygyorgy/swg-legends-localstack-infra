/**
 * Lambda handler: API — Get Resources
 *
 * Serves two endpoints via API Gateway REST API (v1):
 *
 *   GET /resources          — list current resources with optional filters
 *   GET /resources/{id}     — get a specific resource by ID (all planets)
 *
 * Query parameters for GET /resources:
 *   ?planet=Tatooine        — filter by planet  (uses by-planet GSI)
 *   ?class=Copper           — filter by class   (uses by-class GSI)
 *   ?stat=oq&min=800        — filter by stat threshold
 *   (no params)             — scan all resources
 *
 * This is a "Lambda Proxy Integration" handler. API Gateway passes the
 * full HTTP request as an event, and we return a complete HTTP response
 * (status code, headers, body). API Gateway doesn't transform anything —
 * it's just a pass-through.
 *
 * The query logic mirrors src/query/find-resources.ts but adapted for
 * Lambda's event format instead of CLI args.
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT  — LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM    — AWS region
 *   RESOURCES_TABLE      — DynamoDB table name for current resources
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, ScanCommandInput } from "@aws-sdk/lib-dynamodb";

// ─── Types ───────────────────────────────────────────────────────────
// REST API v1 Lambda Proxy Integration event format.
// Key fields: httpMethod, path, pathParameters, queryStringParameters, body.

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

const VALID_STATS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.RESOURCES_TABLE || "resources";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── CORS headers ────────────────────────────────────────────────────
// REST API v1 doesn't have built-in CORS like HTTP API v2.
// Each Lambda response must include these headers for browsers to
// accept the response. The OPTIONS preflight is handled by MOCK
// integrations in OpenTofu (api-gateway.tf).

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

async function queryByPlanet(
  planet: string,
  filterStat?: string,
  minValue?: number
): Promise<ResourceItem[]> {
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const input: QueryCommandInput = {
    TableName: tableName,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
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

async function queryByClass(
  resourceClass: string,
  filterStat?: string,
  minValue?: number
): Promise<ResourceItem[]> {
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

  try {
    // GET /resources/{id} — specific resource by ID
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
        stats: Object.fromEntries(
          VALID_STATS
            .filter((s) => (first as Record<string, unknown>)[s] !== undefined)
            .map((s) => [s, (first as Record<string, unknown>)[s]])
        ),
      });
    }

    // GET /resources — list with filters
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

    if (planet) {
      items = await queryByPlanet(planet, stat, minValue);
    } else if (resourceClass) {
      items = await queryByClass(resourceClass, stat, minValue);
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
