/**
 * Pipeline Lambda: Archive to S3
 *
 * Final step of the ingestion state machine.
 * Copies the raw XML from the pipeline temp location to a permanent
 * timestamped archive path in S3. Also cleans up temp files.
 *
 * After archiving, writes a "lastSync" metadata record to the event-log
 * DynamoDB table so the frontend can display when data was last synced.
 *
 * Input:  { xmlS3Key: string, ... }
 * Output: { archiveS3Key: string }
 */

import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE || "event-log";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";

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

interface ArchiveInput {
  xmlS3Key: string;
  spawnedCount?: number;
  despawnedCount?: number;
  unchangedCount?: number;
  [key: string]: unknown;
}

interface ArchiveOutput {
  archiveS3Key: string;
  tempFilesCleaned: number;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: ArchiveInput): Promise<ArchiveOutput> {
  console.log("Final step: Archiving raw XML to permanent S3 location");
  console.log("Input event:", JSON.stringify(event));

  const xmlS3Key = event.xmlS3Key;
  if (!xmlS3Key) {
    throw new Error(`xmlS3Key is missing from input. Received keys: ${Object.keys(event).join(", ")}`);
  }

  // Copy raw XML from temp to permanent archive path
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveS3Key = `exports/${timestamp}/currentresources_138.xml`;

  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${event.xmlS3Key}`,
      Key: archiveS3Key,
    })
  );

  console.log(`Archived to s3://${BUCKET}/${archiveS3Key}`);

  // Clean up pipeline temp files
  const tempPrefix = event.xmlS3Key.substring(
    0,
    event.xmlS3Key.lastIndexOf("/") + 1
  );

  let tempFilesCleaned = 0;
  const listResult = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: tempPrefix })
  );

  for (const obj of listResult.Contents ?? []) {
    if (obj.Key) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key })
      );
      tempFilesCleaned++;
    }
  }

  console.log(`Cleaned up ${tempFilesCleaned} temp files from ${tempPrefix}`);

  // Write lastSync metadata record to event-log table.
  // Uses date="META", sk="lastSync" to avoid colliding with real events.
  // Overwritten on every successful pipeline run.
  const syncedAt = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: EVENT_LOG_TABLE,
      Item: {
        date: "META",
        sk: "lastSync",
        syncedAt,
        status: "SUCCEEDED",
        archiveS3Key,
        spawnedCount: event.spawnedCount ?? 0,
        despawnedCount: event.despawnedCount ?? 0,
        unchangedCount: event.unchangedCount ?? 0,
      },
    })
  );

  console.log(`Wrote lastSync metadata: ${syncedAt}`);

  return { archiveS3Key, tempFilesCleaned };
}
