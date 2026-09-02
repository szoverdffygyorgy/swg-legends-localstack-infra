/**
 * Lambda handler: API -- Ops Dashboard
 *
 * Serves: GET /ops/dashboard?logFunction=pipeline-archive
 *
 * Aggregates monitoring data from multiple AWS services into a single
 * response for the frontend Ops dashboard:
 *
 * 1. Pipeline sync metadata (DynamoDB -- event-log META#lastSync)
 * 2. Step Functions execution history (last 10 runs with step details)
 * 3. Lambda metrics (invocations + errors per function, last 24h)
 * 4. SQS queue health (pending, in-flight, DLQ message counts)
 * 5. Recent CloudWatch Logs for a selected function
 *
 * All independent queries are parallelized with Promise.all so one
 * slow query doesn't block the others.
 *
 * Environment variables:
 *   LOCALSTACK_ENDPOINT  -- LocalStack URL
 *   AWS_REGION_CUSTOM    -- AWS region
 *   EVENT_LOG_TABLE      -- DynamoDB table for lastSync metadata
 *   STATE_MACHINE_ARN    -- Step Functions state machine ARN
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  SFNClient,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
} from "@aws-sdk/client-sfn";
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

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

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const eventLogTable = process.env.EVENT_LOG_TABLE || "event-log";
const stateMachineArn = process.env.STATE_MACHINE_ARN || "";
const ACCOUNT_ID = "000000000000";

const credentials = { accessKeyId: "test", secretAccessKey: "test" };

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ endpoint, region, credentials }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const sfnClient = new SFNClient({ endpoint, region, credentials });
const cwClient = new CloudWatchClient({ endpoint, region, credentials });
const cwLogsClient = new CloudWatchLogsClient({ endpoint, region, credentials });
const sqsClient = new SQSClient({ endpoint, region, credentials });

// Known Lambda function names (grouped by purpose)
const LAMBDA_FUNCTIONS = [
  "api-get-resources", "api-get-events", "api-alerts", "api-pipeline-status", "api-ops-dashboard",
  "alert-evaluator", "history-recorder",
  "pipeline-download", "pipeline-parse", "pipeline-diff", "pipeline-update-db",
  "pipeline-log-events", "pipeline-publish-sns", "pipeline-archive",
];

// Known SQS queues
const SQS_QUEUES = [
  { name: "alert-evaluator", dlq: "alert-evaluator-dlq" },
  { name: "history-recorder", dlq: "history-recorder-dlq" },
];

function sqsUrl(queueName: string): string {
  return `http://sqs.${region}.localhost.localstack.cloud:4566/${ACCOUNT_ID}/${queueName}`;
}

// ─── CORS + response helpers ─────────────────────────────────────────

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ─── Data fetchers (each handles its own errors gracefully) ──────────

async function fetchLastSync(): Promise<Record<string, unknown> | null> {
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: eventLogTable, Key: { date: "META", sk: "lastSync" } })
    );
    if (!result.Item) return null;
    return {
      syncedAt: result.Item.syncedAt,
      status: result.Item.status,
      archiveS3Key: result.Item.archiveS3Key,
      spawnedCount: result.Item.spawnedCount,
      despawnedCount: result.Item.despawnedCount,
      unchangedCount: result.Item.unchangedCount,
    };
  } catch (err) {
    console.warn("Failed to fetch lastSync:", err);
    return null;
  }
}

async function fetchExecutions(): Promise<Record<string, unknown>[]> {
  if (!stateMachineArn) return [];
  try {
    const listResult = await sfnClient.send(
      new ListExecutionsCommand({ stateMachineArn, maxResults: 10 })
    );

    const executions: Record<string, unknown>[] = [];

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

      if (exec.executionArn) {
        try {
          const detail = await sfnClient.send(
            new DescribeExecutionCommand({ executionArn: exec.executionArn })
          );
          if (detail.status === "SUCCEEDED" && detail.output) {
            try { executionData.output = JSON.parse(detail.output); } catch { /* ignore */ }
          }
          if (detail.status === "FAILED") {
            executionData.error = detail.error;
            executionData.cause = detail.cause;
          }

          const history = await sfnClient.send(
            new GetExecutionHistoryCommand({ executionArn: exec.executionArn, maxResults: 50 })
          );

          const stepMap = new Map<string, { name: string; status: string }>();
          for (const evt of history.events ?? []) {
            const evtAny = evt as Record<string, unknown>;
            const entered = evtAny.stateEnteredEventDetails as Record<string, string> | undefined;
            const exited = evtAny.stateExitedEventDetails as Record<string, string> | undefined;
            const name = entered?.name ?? exited?.name;
            if (!name) continue;

            const status = evt.type?.includes("Succeeded") || evt.type?.includes("Exited")
              ? "succeeded"
              : evt.type?.includes("Failed") ? "failed" : "entered";
            stepMap.set(name, { name, status });
          }
          executionData.steps = [...stepMap.values()];
        } catch { /* ignore per-execution errors */ }
      }

      executions.push(executionData);
    }

    return executions;
  } catch (err) {
    console.warn("Failed to fetch executions:", err);
    return [];
  }
}

async function fetchLambdaMetrics(): Promise<Record<string, unknown>[]> {
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Build metric queries for invocations and errors for each function
    const queries = LAMBDA_FUNCTIONS.flatMap((fn, i) => [
      {
        Id: `inv_${i}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: "Invocations",
            Dimensions: [{ Name: "FunctionName", Value: fn }],
          },
          Period: 86400,
          Stat: "Sum",
        },
      },
      {
        Id: `err_${i}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: "Errors",
            Dimensions: [{ Name: "FunctionName", Value: fn }],
          },
          Period: 86400,
          Stat: "Sum",
        },
      },
    ]);

    const result = await cwClient.send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: dayAgo,
        EndTime: now,
      })
    );

    return LAMBDA_FUNCTIONS.map((fn, i) => {
      const invResult = result.MetricDataResults?.find((r) => r.Id === `inv_${i}`);
      const errResult = result.MetricDataResults?.find((r) => r.Id === `err_${i}`);
      const invocations = invResult?.Values?.reduce((a, b) => a + b, 0) ?? 0;
      const errors = errResult?.Values?.reduce((a, b) => a + b, 0) ?? 0;

      return { name: fn, invocations: Math.round(invocations), errors: Math.round(errors) };
    });
  } catch (err) {
    console.warn("Failed to fetch Lambda metrics:", err);
    return LAMBDA_FUNCTIONS.map((fn) => ({ name: fn, invocations: 0, errors: 0 }));
  }
}

async function fetchQueueHealth(): Promise<Record<string, unknown>[]> {
  const queues: Record<string, unknown>[] = [];

  for (const q of SQS_QUEUES) {
    try {
      const [mainAttrs, dlqAttrs] = await Promise.all([
        sqsClient.send(new GetQueueAttributesCommand({
          QueueUrl: sqsUrl(q.name),
          AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        })),
        sqsClient.send(new GetQueueAttributesCommand({
          QueueUrl: sqsUrl(q.dlq),
          AttributeNames: ["ApproximateNumberOfMessages"],
        })),
      ]);

      queues.push({
        name: q.name,
        pending: parseInt(mainAttrs.Attributes?.ApproximateNumberOfMessages ?? "0", 10),
        inFlight: parseInt(mainAttrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0", 10),
        dlqMessages: parseInt(dlqAttrs.Attributes?.ApproximateNumberOfMessages ?? "0", 10),
      });
    } catch (err) {
      console.warn(`Failed to fetch queue ${q.name}:`, err);
      queues.push({ name: q.name, pending: 0, inFlight: 0, dlqMessages: 0 });
    }
  }

  return queues;
}

async function fetchRecentLogs(
  logFunction: string
): Promise<{ logs: Record<string, unknown>[]; logFunction: string }> {
  const logGroupName = `/aws/lambda/${logFunction}`;

  try {
    const result = await cwLogsClient.send(
      new FilterLogEventsCommand({
        logGroupName,
        limit: 50,
        interleaved: true,
      })
    );

    const logs = (result.events ?? [])
      .filter((e) => {
        const msg = e.message ?? "";
        // Filter out START/END lines, keep REPORT and app-level logs
        return !msg.startsWith("START ") && !msg.startsWith("END ");
      })
      .map((e) => ({
        timestamp: e.timestamp,
        message: (e.message ?? "").trim(),
      }))
      .reverse(); // newest first

    return { logs, logFunction };
  } catch (err) {
    console.warn(`Failed to fetch logs for ${logFunction}:`, err);
    return { logs: [], logFunction };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log(`API: ${event.httpMethod} ${event.path}`);

  const params = event.queryStringParameters ?? {};
  const logFunction = params.logFunction || "pipeline-archive";

  // Validate log function name
  if (!LAMBDA_FUNCTIONS.includes(logFunction)) {
    return jsonResponse(400, {
      error: `Invalid logFunction: "${logFunction}". Valid: ${LAMBDA_FUNCTIONS.join(", ")}`,
    });
  }

  try {
    // Parallelize all independent queries
    const [lastSync, executions, lambdaMetrics, queues, logsResult] = await Promise.all([
      fetchLastSync(),
      fetchExecutions(),
      fetchLambdaMetrics(),
      fetchQueueHealth(),
      fetchRecentLogs(logFunction),
    ]);

    return jsonResponse(200, {
      lastSync,
      executions,
      lambdaMetrics,
      queues,
      recentLogs: logsResult.logs,
      logFunction: logsResult.logFunction,
    });
  } catch (err) {
    console.error("Error building ops dashboard:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
