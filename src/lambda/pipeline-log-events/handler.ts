/**
 * Pipeline Lambda: Log Events
 *
 * Step 5a of the ingestion state machine (runs in parallel with PublishSNS).
 * Reads the diff from S3 and writes spawn/despawn events to the
 * event-log DynamoDB table.
 *
 * Input:  { diffS3Key: string, ... }
 * Output: { eventsLogged: number }
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE || "event-log";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const BATCH_SIZE = 25;

const ALL_STAT_KEYS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Types ───────────────────────────────────────────────────────────

interface LogEventsInput {
  diffS3Key: string;
  [key: string]: unknown;
}

interface LogEventsOutput {
  eventsLogged: number;
}

function statSummary(stats: Record<string, number>): string {
  return ALL_STAT_KEYS
    .filter((k) => stats[k] !== undefined)
    .map((k) => `${k.toUpperCase()}:${stats[k]}`)
    .join(" ");
}

function statSummaryFromItem(item: Record<string, unknown>): string {
  return ALL_STAT_KEYS
    .filter((k) => item[k] !== undefined)
    .map((k) => `${k.toUpperCase()}:${item[k]}`)
    .join(" ");
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: LogEventsInput): Promise<LogEventsOutput> {
  console.log("Step 5a: Logging events to event-log table");

  // Read diff from S3
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.diffS3Key })
  );
  const diff = JSON.parse(await s3Response.Body!.transformToString("utf-8"));

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();

  const items: Record<string, unknown>[] = [];

  // Spawn events
  for (const resource of diff.spawned) {
    items.push({
      date: dateStr,
      sk: `${timestamp}#${resource.resourceId}`,
      eventType: "SPAWNED",
      resourceId: resource.resourceId,
      resourceName: resource.resourceName,
      resourceClass: resource.resourceClass,
      planets: resource.planets.join(", "),
      statSummary: statSummary(resource.stats),
      detectedAt: timestamp,
    });
  }

  // Despawn events (deduplicated)
  const seenDespawned = new Set<string>();
  for (const item of diff.despawned) {
    if (seenDespawned.has(item.resourceId)) continue;
    seenDespawned.add(item.resourceId);

    items.push({
      date: dateStr,
      sk: `${timestamp}#${item.resourceId}`,
      eventType: "DESPAWNED",
      resourceId: item.resourceId,
      resourceName: item.resourceName,
      resourceClass: item.resourceClass,
      planets: item.allPlanets,
      statSummary: statSummaryFromItem(item),
      detectedAt: timestamp,
    });
  }

  // Data issue events
  for (const issue of diff.dataIssues) {
    items.push({
      date: dateStr,
      sk: `${timestamp}#${issue.resourceId}`,
      eventType: "DATA_ISSUE",
      resourceId: issue.resourceId,
      resourceName: issue.resourceName,
      resourceClass: issue.resourceClass,
      planets: issue.rawPlanets,
      statSummary: "",
      detectedAt: timestamp,
      issue: issue.issue,
    });
  }

  // Batch write
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [EVENT_LOG_TABLE]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }

  console.log(`Logged ${items.length} events`);
  return { eventsLogged: items.length };
}
