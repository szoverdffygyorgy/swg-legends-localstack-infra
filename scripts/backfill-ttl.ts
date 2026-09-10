/**
 * One-time backfill: add expiresAt (TTL) to existing event-log and
 * alert-rules (FIRED) items.
 *
 * DynamoDB TTL was enabled after these items were written, so they lack
 * the expiresAt attribute. This script computes expiresAt from each
 * item's original timestamp so they expire at the correct time relative
 * to when they were created -- same as if TTL had been there from the start.
 *
 * Retention windows:
 *   - event-log items (SPAWNED, DESPAWNED, DATA_ISSUE): 90 days from detectedAt
 *   - alert-rules FIRED items: 30 days from matchedAt
 *
 * Items already older than the retention window will get an expiresAt in
 * the past, and DynamoDB will delete them within ~48 hours.
 *
 * Skipped items (no expiresAt added):
 *   - event-log META item (date="META", sk="lastSync") -- must persist
 *   - alert-rules RULE items (pk="RULE") -- user alert definitions
 *   - Any item that already has expiresAt (idempotent)
 *
 * Idempotent: can be re-run safely.
 *
 * Prerequisites:
 *   1. LocalStack running
 *   2. TTL enabled on both tables (tofu -chdir=tofu/messaging apply)
 *
 * Run with: npm run backfill:ttl
 */

import { ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  createDocClient,
  EVENT_LOG_TABLE,
  ALERT_RULES_TABLE,
  EVENT_TTL_DAYS,
  FIRED_ALERT_TTL_DAYS,
} from "../src/config.js";

const BATCH_SIZE = 25;

/**
 * Convert an ISO 8601 timestamp to a TTL epoch value (original time + N days).
 * Returns the Unix epoch in seconds.
 */
function ttlFromTimestamp(isoTimestamp: string, retentionDays: number): number {
  const epochMs = new Date(isoTimestamp).getTime();
  return Math.floor(epochMs / 1000) + retentionDays * 24 * 60 * 60;
}

// ─── Event-log backfill ──────────────────────────────────────────────

async function backfillEventLog(): Promise<void> {
  console.log("── event-log table ──\n");

  const docClient = createDocClient();

  console.log("  Scanning event-log table...");
  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let toBackfill = 0;
  let alreadyHasTtl = 0;
  let skippedMeta = 0;

  const itemsToWrite: Record<string, unknown>[] = [];

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: EVENT_LOG_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      scanned++;

      // Skip the META singleton (must persist indefinitely)
      if (item.date === "META") {
        skippedMeta++;
        continue;
      }

      // Skip items that already have expiresAt
      if (item.expiresAt !== undefined) {
        alreadyHasTtl++;
        continue;
      }

      // Compute expiresAt from the item's original detectedAt timestamp
      const detectedAt = item.detectedAt as string;
      if (!detectedAt) {
        // Safety: skip items without a timestamp (shouldn't happen)
        continue;
      }

      itemsToWrite.push({
        ...item,
        expiresAt: ttlFromTimestamp(detectedAt, EVENT_TTL_DAYS),
      });
      toBackfill++;
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  Scanned ${scanned} items`);
  console.log(`  To backfill: ${toBackfill} (missing expiresAt)`);
  console.log(`  Already has expiresAt: ${alreadyHasTtl}`);
  console.log(`  Skipped (META): ${skippedMeta}`);

  if (itemsToWrite.length > 0) {
    console.log(`\n  Writing ${itemsToWrite.length} items...`);
    let written = 0;

    for (let i = 0; i < itemsToWrite.length; i += BATCH_SIZE) {
      const batch = itemsToWrite.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [EVENT_LOG_TABLE]: batch.map((item) => ({
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

    console.log(`\n  Done! Added expiresAt to ${written} event-log items`);
  } else {
    console.log("\n  Nothing to backfill -- all items are up to date");
  }
}

// ─── Alert-rules (FIRED) backfill ────────────────────────────────────

async function backfillFiredAlerts(): Promise<void> {
  console.log("\n── alert-rules table (FIRED items) ──\n");

  const docClient = createDocClient();

  console.log("  Scanning alert-rules table...");
  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let toBackfill = 0;
  let alreadyHasTtl = 0;
  let skippedRules = 0;

  const itemsToWrite: Record<string, unknown>[] = [];

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: ALERT_RULES_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      scanned++;

      // Skip RULE items (alert definitions -- must persist indefinitely)
      if (item.pk !== "FIRED") {
        skippedRules++;
        continue;
      }

      // Skip items that already have expiresAt
      if (item.expiresAt !== undefined) {
        alreadyHasTtl++;
        continue;
      }

      // Compute expiresAt from the item's original matchedAt timestamp
      const matchedAt = item.matchedAt as string;
      if (!matchedAt) {
        // Safety: skip items without a timestamp (shouldn't happen)
        continue;
      }

      itemsToWrite.push({
        ...item,
        expiresAt: ttlFromTimestamp(matchedAt, FIRED_ALERT_TTL_DAYS),
      });
      toBackfill++;
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  Scanned ${scanned} items`);
  console.log(`  To backfill: ${toBackfill} FIRED items (missing expiresAt)`);
  console.log(`  Already has expiresAt: ${alreadyHasTtl}`);
  console.log(`  Skipped (RULE): ${skippedRules}`);

  if (itemsToWrite.length > 0) {
    console.log(`\n  Writing ${itemsToWrite.length} items...`);
    let written = 0;

    for (let i = 0; i < itemsToWrite.length; i += BATCH_SIZE) {
      const batch = itemsToWrite.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [ALERT_RULES_TABLE]: batch.map((item) => ({
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

    console.log(`\n  Done! Added expiresAt to ${written} fired alert items`);
  } else {
    console.log("\n  Nothing to backfill -- all items are up to date");
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Backfill DynamoDB TTL ===\n");

  await backfillEventLog();
  await backfillFiredAlerts();

  console.log("\n=== TTL backfill complete ===");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
