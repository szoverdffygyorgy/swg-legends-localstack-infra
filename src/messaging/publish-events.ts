/**
 * Publishes spawn/despawn events to SNS topics.
 *
 * After the pipeline detects changes, this module publishes each event
 * to the appropriate SNS topic:
 *   - Spawned resources -> resource-spawned topic
 *   - Despawned resources -> resource-despawned topic
 *
 * SNS then fans out to the subscribed SQS queues:
 *   - resource-spawned -> alert-evaluator queue
 *   - resource-despawned -> history-recorder queue
 *
 * Each message is a JSON payload containing the full resource data.
 * Consumers (process-history.ts, process-alerts.ts) parse this JSON
 * to do their work.
 */

import { PublishCommand } from "@aws-sdk/client-sns";
import {
  createSNSClient,
  RESOURCE_SPAWNED_TOPIC_ARN,
  RESOURCE_DESPAWNED_TOPIC_ARN,
} from "../config.js";
import type { SWGResource, ResourceItem, DiffResult } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

/**
 * Publish all spawn/despawn events from a diff result to SNS.
 * Returns the total number of messages published.
 */
export async function publishEvents(diff: DiffResult): Promise<number> {
  const spawned = diff.spawned.length;
  const despawnedIds = new Set(diff.despawned.map((i) => i.resourceId));
  const despawned = despawnedIds.size;
  const total = spawned + despawned;

  if (total === 0) {
    console.log("  No events to publish");
    return 0;
  }

  const sns = createSNSClient();
  let published = 0;

  // Publish spawn events
  for (const resource of diff.spawned) {
    const message = JSON.stringify({
      eventType: "SPAWNED",
      resourceId: resource.resourceId,
      resourceName: resource.resourceName,
      resourceClass: resource.resourceClass,
      resourceClassId: resource.resourceClassId,
      planets: resource.planets,
      stats: resource.stats,
      availableTimestamp: resource.availableTimestamp,
      availableBy: resource.availableBy,
    });

    await sns.send(
      new PublishCommand({
        TopicArn: RESOURCE_SPAWNED_TOPIC_ARN,
        Message: message,
      })
    );
    published++;
  }

  // Publish despawn events (deduplicated -- one per resource, not per planet row)
  const seen = new Set<string>();
  for (const item of diff.despawned) {
    if (seen.has(item.resourceId)) continue;
    seen.add(item.resourceId);

    // Build stats object from the flat item attributes
    const stats: Record<string, number> = {};
    for (const key of ALL_STAT_KEYS) {
      if (item[key] !== undefined) {
        stats[key] = item[key] as number;
      }
    }

    const message = JSON.stringify({
      eventType: "DESPAWNED",
      resourceId: item.resourceId,
      resourceName: item.resourceName,
      resourceClass: item.resourceClass,
      resourceClassId: item.resourceClassId,
      planets: item.allPlanets.split(", "),
      stats,
      availableTimestamp: item.availableTimestamp,
      availableBy: item.availableBy,
    });

    await sns.send(
      new PublishCommand({
        TopicArn: RESOURCE_DESPAWNED_TOPIC_ARN,
        Message: message,
      })
    );
    published++;
  }

  console.log(
    `  Published ${published} events (${spawned} spawned, ${despawned} despawned)`
  );
  return published;
}
