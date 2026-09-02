/**
 * One-time backfill: enrich existing resource-history items with
 * classification fields and flatten stats to top-level attributes.
 *
 * Scans all items in the resource-history DynamoDB table, looks up each
 * item's resourceClass in the resource-classes hierarchy table, and
 * updates the item with:
 *   - classPath, classCategory, classGroup (for by-category GSI queries)
 *   - Flattened stats (oq, cr, etc. as top-level attributes for FilterExpressions)
 *
 * Idempotent: can be re-run safely. Items already enriched will be
 * overwritten with the same values.
 *
 * Prerequisites:
 *   1. LocalStack running
 *   2. resource-classes table seeded (npm run seed:classes)
 *   3. resource-history table populated (via pipeline despawn events)
 *   4. resource-history table has the by-category GSI (tofu apply storage)
 *
 * Run with: npm run backfill:history
 */

import { ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  createDocClient,
  RESOURCE_HISTORY_TABLE,
} from "../src/config.js";
import { loadClassCache, getClassification } from "../src/ingest/load-resources.js";

const BATCH_SIZE = 25;

async function main(): Promise<void> {
  console.log("=== Backfill Resource History Classification ===\n");

  const docClient = createDocClient();

  // Load classification cache
  console.log("  Loading classification cache...");
  const classCache = await loadClassCache();
  console.log(`  Loaded ${classCache.size} classes\n`);

  // Scan all history items
  console.log("  Scanning resource-history table...");
  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let enriched = 0;
  let unclassified = 0;
  let alreadyClassified = 0;

  const itemsToWrite: Record<string, unknown>[] = [];

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCE_HISTORY_TABLE,
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

      // Check if already classified with same data and has flattened stats
      const stats = item.stats as Record<string, number> | undefined;
      const hasFlattened = stats ? Object.keys(stats).some((k) => item[k] !== undefined) : true;

      if (
        hasFlattened &&
        item.classPath === classification.classPath &&
        item.classCategory === classification.classCategory &&
        item.classGroup === classification.classGroup
      ) {
        alreadyClassified++;
        continue;
      }

      // Write the full item back with new fields
      const enrichedItem: Record<string, unknown> = {
        ...item,
        classPath: classification.classPath,
        classCategory: classification.classCategory,
        classGroup: classification.classGroup,
      };

      // Flatten stats to top-level attributes
      if (stats && typeof stats === "object") {
        for (const [key, value] of Object.entries(stats)) {
          enrichedItem[key] = value;
        }
      }

      itemsToWrite.push(enrichedItem);
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
            [RESOURCE_HISTORY_TABLE]: batch.map((item) => ({
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

    console.log(`\n  Done! Enriched ${written} items with classification data + flattened stats`);
  } else {
    console.log("\n  Nothing to backfill -- all items are up to date");
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
