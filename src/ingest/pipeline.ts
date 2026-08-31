/**
 * Full ingestion pipeline: orchestrates the complete data flow.
 *
 * Steps:
 * 1. Download + decompress SWGAide XML export
 * 2. Parse XML into typed SWGResource objects
 * 3. Load resources into DynamoDB (denormalized, batch writes)
 * 4. Archive raw XML to S3 with timestamped key
 *
 * Run with: npm run ingest
 */

import { downloadResourceExport } from "./download.js";
import { parseResourceExport } from "./parse-resources.js";
import { loadResources } from "./load-resources.js";
import { uploadToS3 } from "./upload-to-s3.js";

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log("=== SWG Legends Resource Ingestion Pipeline ===\n");

  // Step 1: Download
  console.log("[1/4] Downloading resource export...");
  const xmlPath = await downloadResourceExport();
  console.log();

  // Step 2: Parse
  console.log("[2/4] Parsing XML...");
  const resources = parseResourceExport(xmlPath);
  console.log(`  Parsed ${resources.length} resources\n`);

  // Step 3: Load into DynamoDB
  console.log("[3/4] Loading into DynamoDB...");
  const itemCount = await loadResources(resources);
  console.log();

  // Step 4: Archive to S3
  console.log("[4/4] Archiving to S3...");
  const s3Key = await uploadToS3(xmlPath);
  console.log();

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const planets = new Set(resources.flatMap((r) => r.planets));

  console.log("=== Pipeline Complete ===\n");
  console.log(`  Resources parsed:   ${resources.length}`);
  console.log(`  DynamoDB items:     ${itemCount}`);
  console.log(`  Unique planets:     ${planets.size}`);
  console.log(`  S3 archive:         s3://swg-legends-raw-exports/${s3Key}`);
  console.log(`  Time elapsed:       ${elapsed}s`);
  console.log();
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
