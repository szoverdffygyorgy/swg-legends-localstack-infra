/**
 * Pipeline Lambda: Archive to S3
 *
 * Final step of the ingestion state machine.
 * Copies the raw XML from the pipeline temp location to a permanent
 * timestamped archive path in S3. Also cleans up temp files.
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

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

// ─── Types ───────────────────────────────────────────────────────────

interface ArchiveInput {
  xmlS3Key: string;
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
  // The temp prefix is like "pipeline-temp/2026-08-31T21-00-00-000Z/"
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

  return { archiveS3Key, tempFilesCleaned };
}
