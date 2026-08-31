/**
 * Uploads the raw XML export to S3 as a timestamped archive.
 *
 * Each upload gets a unique key based on the current timestamp:
 *   exports/2026-08-31T13:00:00Z/currentresources_138.xml
 *
 * This means every time you run the ingestion pipeline, you keep a
 * snapshot of the raw data. Over time, you build a history of the
 * resource landscape. This is useful for:
 * - Debugging ("what did the data look like when I loaded it?")
 * - Analysis ("how often does good Copper spawn?")
 * - Recovery ("the parser had a bug, re-process from the raw archive")
 *
 * In real AWS, S3 charges per GB stored + per request. At ~300KB per
 * snapshot and 48 snapshots/day (every 30 min), that's ~14MB/day or
 * ~430MB/month. Costs roughly $0.01/month. Trivial.
 */

import { readFileSync } from "node:fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, RAW_EXPORTS_BUCKET } from "../config.js";

/**
 * Upload a local XML file to S3 with a timestamped key.
 * Returns the S3 key that was written.
 */
export async function uploadToS3(localFilePath: string): Promise<string> {
  const s3 = createS3Client();
  const fileContent = readFileSync(localFilePath);

  // Generate a timestamped key for this snapshot
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const s3Key = `exports/${timestamp}/currentresources_138.xml`;

  await s3.send(
    new PutObjectCommand({
      Bucket: RAW_EXPORTS_BUCKET,
      Key: s3Key,
      Body: fileContent,
      ContentType: "application/xml",
    })
  );

  const sizeKB = Math.round(fileContent.length / 1024);
  console.log(
    `  Uploaded to s3://${RAW_EXPORTS_BUCKET}/${s3Key} (${sizeKB} KB)`
  );

  return s3Key;
}

// Allow running directly: npx tsx src/ingest/upload-to-s3.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2] || "data/currentresources_138.xml";
  console.log("=== Upload XML to S3 ===\n");
  uploadToS3(filePath)
    .then((key) => console.log(`\nDone: ${key}`))
    .catch((err) => {
      console.error("Upload failed:", err);
      process.exit(1);
    });
}
