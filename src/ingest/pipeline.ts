/**
 * Full ingestion pipeline: orchestrates the complete data flow.
 *
 * Phase 2 flow (diff-based):
 * 1. Download + decompress SWGAide XML export
 * 2. Parse XML into typed SWGResource objects
 * 3. Diff against current DynamoDB state
 * 4. Incremental update: add spawned, remove despawned
 *    (or full load if DynamoDB is empty -- first run)
 * 5. Log events to event-log table
 * 6. Publish events to SNS (fans out to SQS queues)
 * 7. Archive raw XML to S3
 * 8. Print summary with spawn/despawn counts
 *
 * Run with: npm run ingest
 */

import { downloadResourceExport } from "./download.js";
import { parseResourceExport } from "./parse-resources.js";
import { loadResources, addResources, removeResources } from "./load-resources.js";
import { diffResources } from "./diff.js";
import { logEvents } from "./log-events.js";
import { publishEvents } from "../messaging/publish-events.js";
import { uploadToS3 } from "./upload-to-s3.js";

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log("=== SWG Legends Resource Ingestion Pipeline ===\n");

  // Step 1: Download
  console.log("[1/7] Downloading resource export...");
  const xmlPath = await downloadResourceExport();
  console.log();

  // Step 2: Parse
  console.log("[2/7] Parsing XML...");
  const { resources, dataIssues } = parseResourceExport(xmlPath);
  console.log(`  Parsed ${resources.length} resources` +
    (dataIssues.length > 0 ? `, ${dataIssues.length} data issue(s)` : "") + "\n");

  // Step 3: Diff against current DynamoDB state
  console.log("[3/7] Computing diff against DynamoDB...");
  const diff = await diffResources(resources, dataIssues);
  console.log();

  // Step 4: Update DynamoDB
  const isFirstRun = diff.unchanged === 0 && diff.despawned.length === 0 && diff.spawned.length === resources.length;

  if (isFirstRun) {
    console.log("[4/7] First run detected -- full load into DynamoDB...");
    await loadResources(resources);
  } else {
    console.log("[4/7] Incremental DynamoDB update...");
    if (diff.spawned.length > 0) {
      await addResources(diff.spawned);
    }
    if (diff.despawned.length > 0) {
      await removeResources(diff.despawned);
    }
    if (diff.spawned.length === 0 && diff.despawned.length === 0) {
      console.log("  No changes to apply");
    }
  }
  console.log();

  // Step 5: Log events
  console.log("[5/7] Logging events...");
  const eventsLogged = await logEvents(diff);
  console.log();

  // Step 6: Publish events to SNS
  console.log("[6/7] Publishing events to SNS...");
  const eventsPublished = await publishEvents(diff);
  console.log();

  // Step 7: Archive to S3
  console.log("[7/7] Archiving to S3...");
  const s3Key = await uploadToS3(xmlPath);
  console.log();

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const planets = new Set(resources.flatMap((r) => r.planets));
  const despawnedUniqueCount = new Set(diff.despawned.map((i) => i.resourceId)).size;

  console.log("=== Pipeline Complete ===\n");
  console.log(`  Resources parsed:   ${resources.length}`);
  console.log(`  Unique planets:     ${planets.size}`);
  console.log(`  Spawned:            ${diff.spawned.length}`);
  console.log(`  Despawned:          ${despawnedUniqueCount}`);
  console.log(`  Unchanged:          ${diff.unchanged}`);
  console.log(`  Data issues:        ${diff.dataIssues.length}`);
  console.log(`  Events logged:      ${eventsLogged}`);
  console.log(`  Events published:   ${eventsPublished}`);
  console.log(`  S3 archive:         s3://swg-legends-raw-exports/${s3Key}`);
  console.log(`  Time elapsed:       ${elapsed}s`);
  console.log();
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
