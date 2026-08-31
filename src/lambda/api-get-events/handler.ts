/**
 * Lambda handler: API — Get Events
 *
 * Serves one endpoint via API Gateway REST API (v1):
 *
 *   GET /events              — list spawn/despawn events
 *
 * Query parameters:
 *   ?date=2026-08-31         — events for a specific date (default: today)
 *   ?type=SPAWNED            — filter by event type (SPAWNED, DESPAWNED, DATA_ISSUE)
 *
 * The event-log DynamoDB table uses date as the partition key, so every
 * query is scoped to a single day. This is efficient — DynamoDB only
 * reads the partition you ask for, not the entire table.
 *
 * Environment variables (set in OpenTofu):
 *   LOCALSTACK_ENDPOINT  — LocalStack URL (for DynamoDB client)
 *   AWS_REGION_CUSTOM    — AWS region
 *   EVENT_LOG_TABLE      — DynamoDB table name for event log
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

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

const VALID_EVENT_TYPES = ["SPAWNED", "DESPAWNED", "DATA_ISSUE"];

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.EVENT_LOG_TABLE || "event-log";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

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

// ─── Today's date helper ─────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const params = event.queryStringParameters ?? {};

  console.log(`API: ${method} ${path}`, JSON.stringify(params));

  try {
    const date = params.date || todayString();
    const eventType = params.type;

    // Validate date format (loose check)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse(400, {
        error: `Invalid date format: "${date}". Expected YYYY-MM-DD.`,
      });
    }

    // Validate event type
    if (eventType && !VALID_EVENT_TYPES.includes(eventType)) {
      return jsonResponse(400, {
        error: `Invalid event type: "${eventType}". Valid types: ${VALID_EVENT_TYPES.join(", ")}`,
      });
    }

    // Query by date partition key
    const expressionValues: Record<string, unknown> = { ":date": date };
    let filterExpression: string | undefined;

    if (eventType) {
      filterExpression = "eventType = :eventType";
      expressionValues[":eventType"] = eventType;
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#d = :date",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: expressionValues,
        FilterExpression: filterExpression,
        ScanIndexForward: false, // newest first
      })
    );

    const events = result.Items ?? [];

    return jsonResponse(200, {
      date,
      count: events.length,
      ...(eventType && { filter: eventType }),
      events,
    });
  } catch (err) {
    console.error("Error handling request:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
