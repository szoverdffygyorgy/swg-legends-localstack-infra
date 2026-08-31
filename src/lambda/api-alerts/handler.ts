/**
 * Lambda handler: API — Alerts
 *
 * Serves four endpoints via API Gateway REST API (v1):
 *
 *   GET    /alerts/rules            — list all alert rules
 *   POST   /alerts/rules            — create a new alert rule
 *   DELETE /alerts/rules/{ruleId}   — delete an alert rule
 *   GET    /alerts/history          — list fired alert history
 *
 * All four operations work on the same DynamoDB table (alert-rules)
 * using the single-table pattern:
 *   pk="RULE"  — alert rule definitions
 *   pk="FIRED" — fired alert records
 *
 * The handler routes requests based on the HTTP method and path.
 * This is a common pattern: one Lambda per domain area, with internal
 * routing. It avoids having a separate Lambda for every endpoint while
 * keeping the handler focused on a single domain (alerts).
 *
 * POST /alerts/rules expects a JSON body:
 *   {
 *     "name": "Good Copper",
 *     "classPattern": "Copper",
 *     "stat": "oq",           // optional
 *     "minValue": 800          // optional, requires stat
 *   }
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT  — LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM    — AWS region
 *   ALERT_RULES_TABLE    — DynamoDB table name for alert rules
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
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

interface CreateRuleBody {
  name?: string;
  classPattern?: string;
  stat?: string;
  minValue?: number;
}

const VALID_STATS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.ALERT_RULES_TABLE || "alert-rules";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── CORS headers ────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

// ─── JSON response helper ────────────────────────────────────────────

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// ─── Route handlers ──────────────────────────────────────────────────

async function listRules(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );

  const rules = (result.Items ?? []).map((item) => ({
    ruleId: item.sk,
    name: item.name,
    classPattern: item.classPattern,
    stat: item.stat,
    minValue: item.minValue,
    enabled: item.enabled,
    createdAt: item.createdAt,
  }));

  return jsonResponse(200, { count: rules.length, rules });
}

async function createRule(body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return jsonResponse(400, { error: "Request body is required" });
  }

  let parsed: CreateRuleBody;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON in request body" });
  }

  const { name, classPattern, stat, minValue } = parsed;

  // Validate required fields
  if (!name || !classPattern) {
    return jsonResponse(400, {
      error: "Missing required fields: name, classPattern",
      example: {
        name: "Good Copper",
        classPattern: "Copper",
        stat: "oq",
        minValue: 800,
      },
    });
  }

  // Validate stat
  if (stat && !VALID_STATS.includes(stat)) {
    return jsonResponse(400, {
      error: `Invalid stat: "${stat}". Valid stats: ${VALID_STATS.join(", ")}`,
    });
  }

  // Validate minValue requires stat
  if (minValue !== undefined && !stat) {
    return jsonResponse(400, { error: "minValue requires stat" });
  }

  const ruleId = `r_${Date.now()}`;
  const now = new Date().toISOString();

  const item: Record<string, unknown> = {
    pk: "RULE",
    sk: ruleId,
    name,
    classPattern,
    enabled: true,
    createdAt: now,
  };

  if (stat) item.stat = stat;
  if (minValue !== undefined) item.minValue = minValue;

  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));

  return jsonResponse(201, {
    message: "Alert rule created",
    rule: {
      ruleId,
      name,
      classPattern,
      stat: stat || null,
      minValue: minValue ?? null,
      enabled: true,
      createdAt: now,
    },
  });
}

async function deleteRule(ruleId: string): Promise<APIGatewayProxyResult> {
  // DynamoDB DeleteItem is idempotent — it succeeds even if the item
  // doesn't exist. We use a condition expression to detect that case
  // and return a 404 instead of a silent success.
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: "RULE", sk: ruleId },
        ConditionExpression: "attribute_exists(pk)",
      })
    );
    return jsonResponse(200, { message: "Alert rule deleted", ruleId });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return jsonResponse(404, { error: "Alert rule not found", ruleId });
    }
    throw err;
  }
}

async function listFiredAlerts(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "FIRED" },
      ScanIndexForward: false, // newest first
    })
  );

  const alerts = (result.Items ?? []).map((item) => ({
    ruleId: item.ruleId,
    ruleName: item.ruleName,
    resourceId: item.resourceId,
    resourceName: item.resourceName,
    resourceClass: item.resourceClass,
    planets: item.planets,
    stats: item.stats,
    matchedAt: item.matchedAt,
  }));

  return jsonResponse(200, { count: alerts.length, alerts });
}

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const pathParams = event.pathParameters ?? {};

  console.log(`API: ${method} ${path}`);

  try {
    // DELETE /alerts/rules/{ruleId}
    if (method === "DELETE" && pathParams.ruleId) {
      return await deleteRule(pathParams.ruleId);
    }

    // POST /alerts/rules
    if (method === "POST" && path.endsWith("/alerts/rules")) {
      return await createRule(event.body);
    }

    // GET /alerts/history
    if (method === "GET" && path.endsWith("/alerts/history")) {
      return await listFiredAlerts();
    }

    // GET /alerts/rules
    if (method === "GET" && path.endsWith("/alerts/rules")) {
      return await listRules();
    }

    return jsonResponse(404, { error: `Not found: ${method} ${path}` });
  } catch (err) {
    console.error("Error handling request:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
