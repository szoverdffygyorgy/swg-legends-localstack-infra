/**
 * Pipeline Lambda: Download Export
 *
 * Step 1 of the ingestion state machine.
 * Downloads the SWGAide XML export and uploads it to S3.
 *
 * Lambda has no persistent filesystem -- /tmp is ephemeral and private
 * to this container. So we download to /tmp, then upload to S3 so the
 * next step (ParseXML) can read it.
 *
 * Input:  {} (no input needed)
 * Output: { xmlS3Key: string }
 */

import { createWriteStream, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { get } from "node:https";
import { readFileSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ─── Config ──────────────────────────────────────────────────────────

const SWGAIDE_URL = "https://swgaide.com/pub/exports/currentresources_138.xml.gz";
const TMP_FILE = "/tmp/currentresources_138.xml";
const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

// ─── Handler ─────────────────────────────────────────────────────────

interface DownloadOutput {
  xmlS3Key: string;
  xmlSizeKB: number;
}

export async function handler(): Promise<DownloadOutput> {
  console.log("Step 1: Downloading SWGAide export...");

  // Download and decompress to /tmp
  await new Promise<void>((resolve, reject) => {
    get(SWGAIDE_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const gunzip = createGunzip();
      const fileStream = createWriteStream(TMP_FILE);
      pipeline(response, gunzip, fileStream).then(resolve).catch(reject);
    }).on("error", reject);
  });

  const sizeKB = Math.round(statSync(TMP_FILE).size / 1024);
  console.log(`Downloaded and decompressed: ${sizeKB} KB`);

  // Upload raw XML to S3 for the next step
  const xmlS3Key = `pipeline-temp/${new Date().toISOString().replace(/[:.]/g, "-")}/raw.xml`;
  const content = readFileSync(TMP_FILE);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: xmlS3Key,
      Body: content,
      ContentType: "application/xml",
    })
  );

  console.log(`Uploaded to s3://${BUCKET}/${xmlS3Key}`);

  return { xmlS3Key, xmlSizeKB: sizeKB };
}
