/**
 * Lambda handler: API -- Pipeline Status
 *
 * Serves: GET /pipeline/status
 *
 * Returns:
 * - lastSync: metadata from the most recent successful pipeline run
 *   (read from the event-log DynamoDB table, date="META", sk="lastSync")
 * - executions: recent Step Functions execution history with step details
 *
 * Environment variables:
 *   LOCALSTACK_ENDPOINT   -- LocalStack URL
 *   AWS_REGION_CUSTOM     -- AWS region
 *   EVENT_LOG_TABLE       -- DynamoDB table for event log (contains META#lastSync)
 *   STATE_MACHINE_ARN     -- Step Functions state machine ARN
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  SFNClient,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
} from "@aws-sdk/client-sfn";

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

interface StepDetail {
  name: string;
  status: "entered" | "succeeded" | "failed";
}

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const eventLogTable = process.env.EVENT_LOG_TABLE || "event-log";
const stateMachineArn = process.env.STATE_MACHINE_ARN || "";

const credentials = { accessKeyId: "test", secretAccessKey: "test" };

const ddbClient = new DynamoDBClient({ endpoint, region, credentials });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const sfnClient = new SFNClient({ endpoint, region, credentials });

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

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log(`API: ${event.httpMethod} ${event.path}`);

  try {
    // 1. Read lastSync metadata from DynamoDB
    let lastSync: Record<string, unknown> | null = null;
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: eventLogTable,
          Key: { date: "META", sk: "lastSync" },
        })
      );
      if (result.Item) {
        lastSync = {
          syncedAt: result.Item.syncedAt,
          status: result.Item.status,
          archiveS3Key: result.Item.archiveS3Key,
          spawnedCount: result.Item.spawnedCount,
          despawnedCount: result.Item.despawnedCount,
          unchangedCount: result.Item.unchangedCount,
        };
      }
    } catch (err) {
      console.warn("Failed to read lastSync metadata:", err);
    }

    // 2. Query Step Functions execution history
    const executions: Record<string, unknown>[] = [];

    if (stateMachineArn) {
      try {
        const listResult = await sfnClient.send(
          new ListExecutionsCommand({
            stateMachineArn,
            maxResults: 10,
          })
        );

        for (const exec of listResult.executions ?? []) {
          const startedAt = exec.startDate?.toISOString() ?? null;
          const stoppedAt = exec.stopDate?.toISOString() ?? null;
          const duration = exec.startDate && exec.stopDate
            ? `${((exec.stopDate.getTime() - exec.startDate.getTime()) / 1000).toFixed(1)}s`
            : null;

          const executionData: Record<string, unknown> = {
            executionArn: exec.executionArn,
            status: exec.status ?? "UNKNOWN",
            startedAt,
            stoppedAt,
            duration,
            steps: [],
          };

          // Get step-level detail for each execution
          if (exec.executionArn) {
            try {
              // Get execution output/error
              const detail = await sfnClient.send(
                new DescribeExecutionCommand({ executionArn: exec.executionArn })
              );

              if (detail.status === "SUCCEEDED" && detail.output) {
                try {
                  executionData.output = JSON.parse(detail.output);
                } catch {
                  executionData.output = detail.output;
                }
              }
              if (detail.status === "FAILED") {
                executionData.error = detail.error;
                executionData.cause = detail.cause;
              }

              // Get step history
              const history = await sfnClient.send(
                new GetExecutionHistoryCommand({
                  executionArn: exec.executionArn,
                  maxResults: 50,
                })
              );

              const steps: StepDetail[] = [];
              for (const evt of history.events ?? []) {
                const evtAny = evt as Record<string, unknown>;
                const enteredDetails = evtAny.stateEnteredEventDetails as Record<string, string> | undefined;
                const exitedDetails = evtAny.stateExitedEventDetails as Record<string, string> | undefined;
                const name = enteredDetails?.name ?? exitedDetails?.name;

                if (!name) continue;

                if (evt.type?.includes("Succeeded") || evt.type?.includes("Exited")) {
                  steps.push({ name, status: "succeeded" });
                } else if (evt.type?.includes("Failed")) {
                  steps.push({ name, status: "failed" });
                } else if (evt.type?.includes("Entered")) {
                  steps.push({ name, status: "entered" });
                }
              }

              // Deduplicate: keep the last status for each step name
              const stepMap = new Map<string, StepDetail>();
              for (const step of steps) {
                stepMap.set(step.name, step);
              }
              executionData.steps = [...stepMap.values()];
            } catch (err) {
              console.warn(`Failed to get details for execution:`, err);
            }
          }

          executions.push(executionData);
        }
      } catch (err) {
        console.warn("Failed to list Step Functions executions:", err);
      }
    }

    return jsonResponse(200, {
      lastSync,
      executions,
    });
  } catch (err) {
    console.error("Error handling request:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
