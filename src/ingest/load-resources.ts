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

import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, RESOURCES_TABLE, RESOURCE_CLASSES_TABLE } from "../config.js";
import type { SWGResource, ResourceItem } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

/** DynamoDB BatchWriteItem limit */
const BATCH_SIZE = 25;

// ─── Classification cache ────────────────────────────────────────────

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

/**
 * Load all resource class nodes from the resource-classes table.
 * Returns a Map keyed by className (e.g., "Desh Copper").
 */
export async function loadClassCache(): Promise<Map<string, ClassInfo>> {
  const docClient = createDocClient();
  const cache = new Map<string, ClassInfo>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCE_CLASSES_TABLE,
        ProjectionExpression: "className, treePath, #d",
        ExpressionAttributeNames: { "#d": "depth" },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items ?? []) {
      cache.set(item.className as string, {
        treePath: item.treePath as string,
        className: item.className as string,
        depth: item.depth as number,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return cache;
}

/**
 * Extract classification fields from the hierarchy cache.
 * Returns classPath, classCategory (root level), classGroup (second level).
 */
export function getClassification(
  cache: Map<string, ClassInfo>,
  resourceClass: string
): { classPath: string; classCategory: string; classGroup: string } | null {
  const info = cache.get(resourceClass);
  if (!info) return null;

  const segments = info.treePath.split("/");

  // Look up the actual classNames for proper casing at depth 0 and 1
  let category: string | undefined;
  let group: string | undefined;

  if (segments.length >= 1) {
    for (const [, node] of cache) {
      if (node.depth === 0 && node.treePath === segments[0]) {
        category = node.className;
        break;
      }
    }
  }

  if (segments.length >= 2) {
    const groupPath = segments.slice(0, 2).join("/");
    for (const [, node] of cache) {
      if (node.depth === 1 && node.treePath === groupPath) {
        group = node.className;
        break;
      }
    }
  }

  return {
    classPath: info.treePath,
    classCategory: category ?? segments[0] ?? "",
    classGroup: group ?? segments[1] ?? "",
  };
}

/**
 * Convert an SWGResource into one or more ResourceItems (one per planet).
 * Enriches with classification data if a cache is provided.
 */
export function denormalize(
  resource: SWGResource,
  classCache?: Map<string, ClassInfo>
): ResourceItem[] {
  // Safety net: skip resources with no valid planets
  // (should be caught by the parser, but just in case)
  if (resource.planets.length === 0) {
    return [];
  }

  const baseItem: Record<string, unknown> = {
    resourceId: resource.resourceId,
    resourceName: resource.resourceName,
    resourceClass: resource.resourceClass,
    resourceClassId: resource.resourceClassId,
    allPlanets: resource.planets.join(", "),
    availableTimestamp: resource.availableTimestamp,
    availableBy: resource.availableBy,
  };

  // Enrich with classification data if cache is available
  if (classCache) {
    const classification = getClassification(classCache, resource.resourceClass);
    if (classification) {
      baseItem.classPath = classification.classPath;
      baseItem.classCategory = classification.classCategory;
      baseItem.classGroup = classification.classGroup;
    }
  }

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

  // Load classification cache for enrichment
  console.log("  Loading classification cache...");
  const classCache = await loadClassCache();
  console.log(`  Classification cache: ${classCache.size} classes`);

  // Denormalize all resources into items (with classification)
  const allItems: ResourceItem[] = resources.flatMap((r) => denormalize(r, classCache));
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

/**
 * Add only new resources (incremental insert).
 * Used by the diff-based pipeline instead of full reload.
 * Returns the number of items written.
 */
export async function addResources(
  resources: SWGResource[]
): Promise<number> {
  if (resources.length === 0) return 0;

  const docClient = createDocClient();

  // Load classification cache for enrichment
  const classCache = await loadClassCache();
  const allItems: ResourceItem[] = resources.flatMap((r) => denormalize(r, classCache));

  console.log(
    `  Adding ${resources.length} new resources (${allItems.length} items)`
  );

  let written = 0;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);

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
  }

  console.log(`  Added ${written} items`);
  return written;
}

/**
 * Remove despawned resources from DynamoDB.
 * Takes the raw ResourceItem[] from the diff (includes all planet rows).
 * Returns the number of items deleted.
 */
export async function removeResources(
  items: ResourceItem[]
): Promise<number> {
  if (items.length === 0) return 0;

  const docClient = createDocClient();
  const uniqueIds = new Set(items.map((i) => i.resourceId));

  console.log(
    `  Removing ${uniqueIds.size} despawned resources (${items.length} items)`
  );

  let deleted = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [RESOURCES_TABLE]: batch.map((item) => ({
            DeleteRequest: {
              Key: {
                resourceId: item.resourceId,
                planet: item.planet,
              },
            },
          })),
        },
      })
    );

    deleted += batch.length;
  }

  console.log(`  Deleted ${deleted} items`);
  return deleted;
}

// Allow running directly: npx tsx src/ingest/load-resources.ts
// Expects data/currentresources_138.xml to exist (run download.ts first)
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const { parseResourceExport } = await import("./parse-resources.js");

    const filePath = process.argv[2] || "data/currentresources_138.xml";
    console.log("=== Load Resources into DynamoDB ===\n");
    console.log(`  Parsing: ${filePath}`);

    const { resources, dataIssues } = parseResourceExport(filePath);
    console.log(`  Parsed ${resources.length} resources, ${dataIssues.length} data issues\n`);

    const itemCount = await loadResources(resources);
    console.log(`\nDone: ${itemCount} items written to DynamoDB`);
  })().catch((err) => {
    console.error("Load failed:", err);
    process.exit(1);
  });
}
