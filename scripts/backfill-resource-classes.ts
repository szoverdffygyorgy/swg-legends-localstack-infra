/**
 * One-time backfill: add classification fields to existing resource items.
 *
 * Scans all items in the resources DynamoDB table, looks up each item's
 * resourceClass in the resource-classes hierarchy table, and updates the
 * item with classPath, classCategory, and classGroup fields.
 *
 * Idempotent: can be re-run safely. Items already classified will be
 * overwritten with the same values.
 *
 * Prerequisites:
 *   1. LocalStack running
 *   2. resource-classes table seeded (npm run seed:classes)
 *   3. resources table populated (npm run ingest or pipeline)
 *
 * Run with: npm run backfill:classes
 */

import { ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  createDocClient,
  RESOURCES_TABLE,
} from "../src/config.js";
import { loadClassCache, getClassification } from "../src/ingest/load-resources.js";

const BATCH_SIZE = 25;

async function main(): Promise<void> {
  console.log("=== Backfill Resource Classification ===\n");

  const docClient = createDocClient();

  // Load classification cache
  console.log("  Loading classification cache...");
  const classCache = await loadClassCache();
  console.log(`  Loaded ${classCache.size} classes\n`);

  // Scan all resource items
  console.log("  Scanning resources table...");
  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let enriched = 0;
  let unclassified = 0;
  let alreadyClassified = 0;

  const itemsToWrite: Record<string, unknown>[] = [];

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCES_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      scanned++;
      const resourceClass = item.resourceClass as string;
      const classification = getClassification(classCache, resourceClass);

      if (!classification) {
        unclassified++;
        continue;
      }

      // Check if already classified with same data
      if (
        item.classPath === classification.classPath &&
        item.classCategory === classification.classCategory &&
        item.classGroup === classification.classGroup
      ) {
        alreadyClassified++;
        continue;
      }

      // Write the full item back with new fields
      itemsToWrite.push({
        ...item,
        classPath: classification.classPath,
        classCategory: classification.classCategory,
        classGroup: classification.classGroup,
      });
      enriched++;
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  Scanned ${scanned} items`);
  console.log(`  To enrich: ${enriched}`);
  console.log(`  Already classified: ${alreadyClassified}`);
  if (unclassified > 0) {
    console.log(`  Unclassified (no matching class): ${unclassified}`);
  }

  // Batch write enriched items
  if (itemsToWrite.length > 0) {
    console.log(`\n  Writing ${itemsToWrite.length} enriched items...`);
    let written = 0;

    for (let i = 0; i < itemsToWrite.length; i += BATCH_SIZE) {
      const batch = itemsToWrite.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [RESOURCES_TABLE]: batch.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        })
      );
      written += batch.length;
      if (written % 100 < BATCH_SIZE) {
        console.log(`  Written ${written}/${itemsToWrite.length}...`);
      }
    }

    console.log(`\n  Done! Enriched ${written} items with classification data`);
  } else {
    console.log("\n  Nothing to backfill -- all items are up to date");
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
