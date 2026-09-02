/**
 * Lambda handler: API -- Alerts
 *
 * Serves four endpoints via API Gateway REST API (v1):
 *
 *   GET    /alerts/rules            -- list all alert rules
 *   POST   /alerts/rules            -- create a new alert rule
 *   PUT    /alerts/rules/{ruleId}   -- toggle alert rule enabled/disabled
 *   DELETE /alerts/rules/{ruleId}   -- delete an alert rule
 *   GET    /alerts/history          -- list fired alert history
 *
 * POST /alerts/rules accepts:
 *   {
 *     "name": "Endgame Metal",
 *     "classPattern": "Metal",                    // hierarchy-aware
 *     "statThresholds": { "oq": 800, "sr": 400 }, // optional, AND logic
 *     "planets": ["Tatooine", "Naboo"]             // optional, OR logic
 *   }
 *
 * Legacy format (still accepted, normalized to statThresholds):
 *   {
 *     "name": "Good Copper",
 *     "classPattern": "Copper",
 *     "stat": "oq",
 *     "minValue": 800
 *   }
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT  -- LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM    -- AWS region
 *   ALERT_RULES_TABLE    -- DynamoDB table name for alert rules
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
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
  statThresholds?: Record<string, number>;
  planets?: string[];
  // Legacy format (normalized to statThresholds)
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
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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
 * Normalize a rule item from DynamoDB to the new response format.
 * Converts legacy stat/minValue to statThresholds, ensures planets is an array.
 */
function normalizeRule(item: Record<string, unknown>) {
  // Normalize stat thresholds
  let statThresholds = item.statThresholds as Record<string, number> | undefined;
  if (!statThresholds && item.stat && item.minValue !== undefined) {
    statThresholds = { [item.stat as string]: item.minValue as number };
  }

  return {
    ruleId: item.sk,
    name: item.name,
    classPattern: item.classPattern,
    statThresholds: statThresholds ?? {},
    planets: (item.planets as string[]) ?? [],
    enabled: item.enabled,
    createdAt: item.createdAt,
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

  const rules = (result.Items ?? []).map(normalizeRule);
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

  const { name, classPattern } = parsed;

  // Validate required fields
  if (!name || !classPattern) {
    return jsonResponse(400, {
      error: "Missing required fields: name, classPattern",
      example: {
        name: "Endgame Metal",
        classPattern: "Metal",
        statThresholds: { oq: 800, sr: 400 },
        planets: ["Tatooine"],
      },
    });
  }

  // Normalize stat thresholds: accept new format or legacy format
  let statThresholds: Record<string, number> = {};

  if (parsed.statThresholds && typeof parsed.statThresholds === "object") {
    // New format: { "oq": 800, "sr": 400 }
    statThresholds = parsed.statThresholds;
  } else if (parsed.stat && parsed.minValue !== undefined) {
    // Legacy format: stat + minValue -> convert
    statThresholds = { [parsed.stat]: parsed.minValue };
  }

  // Validate all stat keys in thresholds
  for (const key of Object.keys(statThresholds)) {
    if (!VALID_STATS.includes(key)) {
      return jsonResponse(400, {
        error: `Invalid stat in statThresholds: "${key}". Valid stats: ${VALID_STATS.join(", ")}`,
      });
    }
    if (typeof statThresholds[key] !== "number" || statThresholds[key] < 0) {
      return jsonResponse(400, {
        error: `Invalid threshold for ${key}: must be a non-negative number`,
      });
    }
  }

  // Validate planets
  const planets = parsed.planets ?? [];
  if (!Array.isArray(planets)) {
    return jsonResponse(400, { error: "planets must be an array of strings" });
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

  // Store in new format only
  if (Object.keys(statThresholds).length > 0) {
    item.statThresholds = statThresholds;
  }
  if (planets.length > 0) {
    item.planets = planets;
  }

  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));

  return jsonResponse(201, {
    message: "Alert rule created",
    rule: {
      ruleId,
      name,
      classPattern,
      statThresholds,
      planets,
      enabled: true,
      createdAt: now,
    },
  });
}

async function deleteRule(ruleId: string): Promise<APIGatewayProxyResult> {
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

async function toggleRule(ruleId: string): Promise<APIGatewayProxyResult> {
  try {
    // Flip the enabled boolean using SET enabled = NOT enabled
    // DynamoDB doesn't support NOT directly, so we use a two-step:
    // read the current value, then update with the opposite.
    const getResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: { ":pk": "RULE", ":sk": ruleId },
      })
    );

    const items = getResult.Items ?? [];
    if (items.length === 0) {
      return jsonResponse(404, { error: "Alert rule not found", ruleId });
    }

    const currentEnabled = items[0].enabled as boolean;
    const newEnabled = !currentEnabled;

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: "RULE", sk: ruleId },
        UpdateExpression: "SET #enabled = :val",
        ExpressionAttributeNames: { "#enabled": "enabled" },
        ExpressionAttributeValues: { ":val": newEnabled },
      })
    );

    const rule = normalizeRule({ ...items[0], enabled: newEnabled });
    return jsonResponse(200, {
      message: `Alert rule ${newEnabled ? "enabled" : "disabled"}`,
      rule,
    });
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

    // PUT /alerts/rules/{ruleId} -- toggle enabled/disabled
    if (method === "PUT" && pathParams.ruleId) {
      return await toggleRule(pathParams.ruleId);
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
