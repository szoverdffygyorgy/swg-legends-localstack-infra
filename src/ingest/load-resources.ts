/**
 * Loads parsed SWG resources into DynamoDB.
 *
 * The key concept here is DENORMALIZATION. In a SQL database, you'd have:
 *   - resources table (one row per resource)
 *   - resource_planets table (one row per resource-planet pair)
 *   - JOIN them at query time
 *
 * DynamoDB has no JOINs. So instead, we store one item per resource-planet
 * combination in a single table. A resource on 3 planets becomes 3 items.
 *
 * This feels wasteful if you're used to SQL, but it's the standard
 * DynamoDB pattern. The tradeoff:
 *   - Writes: slightly more expensive (3 items instead of 1)
 *   - Reads: fast and simple -- "all resources on Tatooine" is a single
 *     query on the by-planet GSI, no JOINs needed
 *
 * DynamoDB BatchWriteItem:
 * - Writes up to 25 items per batch (hard limit)
 * - More efficient than individual PutItem calls (fewer HTTP round-trips)
 * - Items in a batch can target different keys (but same table)
 * - If any item in the batch fails, it's returned in UnprocessedItems
 *   (we retry those)
 */

import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, RESOURCES_TABLE } from "../config.js";
import type { SWGResource, ResourceItem } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

/** DynamoDB BatchWriteItem limit */
const BATCH_SIZE = 25;

/**
 * Convert an SWGResource into one or more ResourceItems (one per planet).
 */
function denormalize(resource: SWGResource): ResourceItem[] {
  const baseItem = {
    resourceId: resource.resourceId,
    resourceName: resource.resourceName,
    resourceClass: resource.resourceClass,
    resourceClassId: resource.resourceClassId,
    allPlanets: resource.planets.join(", "),
    availableTimestamp: resource.availableTimestamp,
    availableBy: resource.availableBy,
  };

  // Flatten stats into top-level attributes
  const statsFlat: Record<string, number> = {};
  for (const key of ALL_STAT_KEYS) {
    if (resource.stats[key] !== undefined) {
      statsFlat[key] = resource.stats[key]!;
    }
  }

  // One item per planet
  return resource.planets.map((planet) => ({
    ...baseItem,
    ...statsFlat,
    planet,
  }));
}

/**
 * Load resources into DynamoDB using batch writes.
 * Returns the total number of items written.
 */
export async function loadResources(
  resources: SWGResource[]
): Promise<number> {
  const docClient = createDocClient();

  // Denormalize all resources into items
  const allItems: ResourceItem[] = resources.flatMap(denormalize);
  console.log(
    `  Denormalized ${resources.length} resources into ${allItems.length} items`
  );

  // Write in batches of 25
  let written = 0;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);

    const putRequests = batch.map((item) => ({
      PutRequest: { Item: item },
    }));

    let unprocessed: typeof putRequests | undefined = putRequests;
    let retries = 0;

    // Retry loop for unprocessed items.
    // DynamoDB may return UnprocessedItems if it's throttled or if
    // there's a transient error. In a real production system you'd
    // use exponential backoff. For LocalStack, this rarely triggers.
    while (unprocessed && unprocessed.length > 0 && retries < 5) {
      const result = await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [RESOURCES_TABLE]: unprocessed,
          },
        })
      );

      const remaining = result.UnprocessedItems?.[RESOURCES_TABLE];
      if (remaining && remaining.length > 0) {
        unprocessed = remaining as typeof putRequests;
        retries++;
        // Simple backoff: wait 100ms * retry count
        await new Promise((resolve) => setTimeout(resolve, 100 * retries));
      } else {
        unprocessed = undefined;
      }
    }

    written += batch.length;

    // Progress indicator every 10 batches
    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= allItems.length) {
      console.log(
        `  Written ${written}/${allItems.length} items (${Math.round((written / allItems.length) * 100)}%)`
      );
    }
  }

  return written;
}

// Allow running directly: npx tsx src/ingest/load-resources.ts
// Expects data/currentresources_138.xml to exist (run download.ts first)
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const { parseResourceExport } = await import("./parse-resources.js");

    const filePath = process.argv[2] || "data/currentresources_138.xml";
    console.log("=== Load Resources into DynamoDB ===\n");
    console.log(`  Parsing: ${filePath}`);

    const resources = parseResourceExport(filePath);
    console.log(`  Parsed ${resources.length} resources\n`);

    const itemCount = await loadResources(resources);
    console.log(`\nDone: ${itemCount} items written to DynamoDB`);
  })().catch((err) => {
    console.error("Load failed:", err);
    process.exit(1);
  });
}
