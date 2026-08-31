/**
 * Diff engine: compares fresh XML export against current DynamoDB state.
 *
 * Produces a DiffResult with:
 * - spawned: resources in the XML but not in DynamoDB (new)
 * - despawned: resources in DynamoDB but not in the XML (gone)
 * - unchanged: count of resources present in both
 *
 * The diff is based on resource IDs only. We don't detect stat changes
 * on existing resources (that would be a "resource updated" event, which
 * SWG doesn't really do -- stats are fixed at spawn time).
 *
 * Run standalone: npm run diff
 */

import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, RESOURCES_TABLE } from "../config.js";
import type { SWGResource, ResourceItem, DiffResult, DataIssue } from "../types.js";

/**
 * Fetch all unique resource IDs from DynamoDB.
 * Returns a Map of resourceId -> ResourceItem[] (one per planet).
 */
async function fetchCurrentResourceIds(): Promise<Map<string, ResourceItem[]>> {
  const docClient = createDocClient();
  const byId = new Map<string, ResourceItem[]>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCES_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of (result.Items ?? []) as ResourceItem[]) {
      const existing = byId.get(item.resourceId);
      if (existing) {
        existing.push(item);
      } else {
        byId.set(item.resourceId, [item]);
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return byId;
}

/**
 * Compare parsed XML resources against the current DynamoDB state.
 */
export async function diffResources(
  xmlResources: SWGResource[],
  dataIssues: DataIssue[] = []
): Promise<DiffResult> {
  console.log("  Fetching current resource IDs from DynamoDB...");
  const currentById = await fetchCurrentResourceIds();
  const currentIds = new Set(currentById.keys());
  const xmlIds = new Set(xmlResources.map((r) => r.resourceId));

  console.log(
    `  DynamoDB: ${currentIds.size} unique resources, XML: ${xmlIds.size} resources`
  );

  // Spawned: in XML but not in DynamoDB
  const spawned = xmlResources.filter((r) => !currentIds.has(r.resourceId));

  // Despawned: in DynamoDB but not in XML
  // Collect all items (all planet rows) for each despawned resource
  const despawned: ResourceItem[] = [];
  for (const [id, items] of currentById) {
    if (!xmlIds.has(id)) {
      despawned.push(...items);
    }
  }

  // Count unique despawned resources (not items, since multi-planet = multiple items)
  const despawnedIds = new Set(despawned.map((i) => i.resourceId));

  const unchanged = xmlIds.size - spawned.length;

  console.log(
    `  Diff: ${spawned.length} spawned, ${despawnedIds.size} despawned, ${unchanged} unchanged` +
    (dataIssues.length > 0 ? `, ${dataIssues.length} data issue(s)` : "")
  );

  return { spawned, despawned, unchanged, dataIssues };
}

// Allow running directly: npm run diff
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const { parseResourceExport } = await import("./parse-resources.js");
    const { downloadResourceExport } = await import("./download.js");

    console.log("=== Resource Diff ===\n");

    console.log("[1/3] Downloading latest export...");
    const xmlPath = await downloadResourceExport();
    console.log();

    console.log("[2/3] Parsing XML...");
    const { resources, dataIssues } = parseResourceExport(xmlPath);
    console.log(`  Parsed ${resources.length} resources, ${dataIssues.length} data issues\n`);

    console.log("[3/3] Computing diff...");
    const diff = await diffResources(resources, dataIssues);
    console.log();

    if (diff.spawned.length > 0) {
      console.log("  NEW SPAWNS:");
      for (const r of diff.spawned) {
        const stats = Object.entries(r.stats)
          .map(([k, v]) => `${k.toUpperCase()}:${v}`)
          .join(" ");
        console.log(
          `    + ${r.resourceName} (${r.resourceClass}) [${r.planets.join(", ")}] ${stats}`
        );
      }
      console.log();
    }

    if (diff.despawned.length > 0) {
      // Deduplicate for display (multi-planet items)
      const seen = new Set<string>();
      console.log("  DESPAWNED:");
      for (const item of diff.despawned) {
        if (seen.has(item.resourceId)) continue;
        seen.add(item.resourceId);
        console.log(
          `    - ${item.resourceName} (${item.resourceClass}) [${item.allPlanets}]`
        );
      }
      console.log();
    }

    if (diff.spawned.length === 0 && diff.despawned.length === 0) {
      console.log("  No changes detected.\n");
    }
  })().catch((err) => {
    console.error("Diff failed:", err);
    process.exit(1);
  });
}
