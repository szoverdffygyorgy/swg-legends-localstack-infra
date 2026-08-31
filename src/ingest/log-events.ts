/**
 * Writes spawn/despawn events to the event-log DynamoDB table.
 *
 * Each event is a single item in the table:
 * - Partition key: date (e.g., "2026-08-31") -- groups by day
 * - Sort key: "timestamp#resourceId" -- chronological + unique
 *
 * This creates a queryable log of everything that happened.
 * "Show me all events from today" = query with date = today.
 */

import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, EVENT_LOG_TABLE } from "../config.js";
import type { SWGResource, ResourceItem, DiffResult, EventLogItem, StatKey } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

/**
 * Build a stat summary string like "OQ:978 DR:448 PE:283"
 */
function statSummaryFromResource(resource: SWGResource): string {
  return ALL_STAT_KEYS
    .filter((k) => resource.stats[k] !== undefined)
    .map((k) => `${k.toUpperCase()}:${resource.stats[k]}`)
    .join(" ");
}

function statSummaryFromItem(item: ResourceItem): string {
  return ALL_STAT_KEYS
    .filter((k: StatKey) => item[k] !== undefined)
    .map((k: StatKey) => `${k.toUpperCase()}:${item[k]}`)
    .join(" ");
}

/**
 * Write spawn and despawn events to the event-log table.
 * Returns the number of events written.
 */
export async function logEvents(diff: DiffResult): Promise<number> {
  const totalEvents = diff.spawned.length + new Set(diff.despawned.map((i) => i.resourceId)).size;
  if (totalEvents === 0) {
    console.log("  No events to log");
    return 0;
  }

  const docClient = createDocClient();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // "2026-08-31"
  const timestamp = now.toISOString();

  const items: EventLogItem[] = [];

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
      statSummary: statSummaryFromResource(resource),
      detectedAt: timestamp,
    });
  }

  // Despawn events (deduplicate -- one event per resource, not per planet row)
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

  console.log(`  Writing ${items.length} events to event-log table`);

  // Batch write
  const BATCH_SIZE = 25;
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

  console.log(`  Logged ${items.length} events`);
  return items.length;
}
