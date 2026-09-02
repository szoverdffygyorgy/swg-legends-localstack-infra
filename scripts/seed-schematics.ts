/**
 * Seed the schematics DynamoDB table with crafting recipe data.
 *
 * Downloads the SWGAide schematics export, parses all schematics, and
 * writes two types of items to the schematics table:
 *
 *   1. Schematic metadata (pk=SCHEM#{id}, sk=META)
 *      Full recipe data including ingredients and experimental groups.
 *
 *   2. Ingredient class index (pk=CLASS#{className}, sk=SCHEM#{id})
 *      Reverse index for "find schematics that use Metal" queries.
 *
 * Idempotent: PutItem overwrites existing items, safe to re-run.
 *
 * Prerequisites:
 *   1. LocalStack running (docker compose up -d)
 *   2. Table created (npm run tofu:apply:schematics)
 *
 * Run with: npm run schematics:seed
 */

import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, SCHEMATICS_TABLE } from "../src/config.js";
import { downloadSchematicExport } from "../src/ingest/download-schematics.js";
import { parseSchematicExport } from "../src/ingest/parse-schematics.js";
import type { Schematic } from "../src/types.js";

const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit

/**
 * Convert a parsed Schematic into a DynamoDB metadata item.
 */
function buildMetadataItem(s: Schematic): Record<string, unknown> {
  return {
    pk: `SCHEM#${s.schematicId}`,
    sk: "META",
    schematicId: s.schematicId,
    name: s.name,
    category: s.category,
    base: s.base,
    description: s.description || undefined,
    complexity: s.complexity,
    xp: s.xp,
    dataSize: s.dataSize,
    manufacture: s.manufacture,
    type: s.type,
    crateSize: s.crateSize,
    quality: s.quality,
    profession: s.profession,
    professionLevel: s.professionLevel,
    ingredients: s.ingredients,
    experimentalGroups: s.experimentalGroups,
  };
}

/**
 * Build ingredient class index items for a schematic.
 * One item per unique resource className referenced by this schematic.
 */
function buildClassIndexItems(s: Schematic): Record<string, unknown>[] {
  // Deduplicate: a schematic may reference the same class in multiple slots
  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];

  for (const ing of s.ingredients) {
    if (ing.type === "resource" && ing.className && !seen.has(ing.className)) {
      seen.add(ing.className);
      items.push({
        pk: `CLASS#${ing.className}`,
        sk: `SCHEM#${s.schematicId}`,
        schematicId: s.schematicId,
        schematicName: s.name,
        base: s.base,
        category: s.category,
        quality: s.quality,
        experimentalGroups: s.experimentalGroups,
      });
    }
  }

  return items;
}

async function main(): Promise<void> {
  console.log("=== Seed Schematics ===\n");

  // Step 1: Download
  console.log("Step 1: Download schematics export");
  const xmlPath = await downloadSchematicExport();
  console.log("");

  // Step 2: Parse
  console.log("Step 2: Parse schematics XML");
  const { schematics, unresolvedClassIds } = parseSchematicExport(xmlPath);
  console.log(`  Parsed ${schematics.length} schematics`);

  if (unresolvedClassIds.size > 0) {
    console.error(`  ERROR: ${unresolvedClassIds.size} unresolved class IDs:`, [...unresolvedClassIds]);
    process.exit(1);
  }
  console.log("");

  // Step 3: Build all DynamoDB items
  console.log("Step 3: Build DynamoDB items");
  const allItems: Record<string, unknown>[] = [];

  for (const s of schematics) {
    allItems.push(buildMetadataItem(s));
    allItems.push(...buildClassIndexItems(s));
  }

  const metaCount = schematics.length;
  const indexCount = allItems.length - metaCount;
  console.log(`  ${metaCount} metadata items + ${indexCount} class index items = ${allItems.length} total`);
  console.log("");

  // Step 4: Batch write
  console.log("Step 4: Write to DynamoDB");
  const docClient = createDocClient();
  let written = 0;

  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [SCHEMATICS_TABLE]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );

    written += batch.length;
    if (written % 500 < BATCH_SIZE) {
      console.log(`  Written ${written}/${allItems.length} items...`);
    }
  }

  console.log(`  Written ${written}/${allItems.length} items`);
  console.log("");

  // Step 5: Verify
  console.log("Step 5: Verify");
  let count = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: SCHEMATICS_TABLE,
        Select: "COUNT",
        ExclusiveStartKey: lastKey,
      })
    );
    count += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  Table contains ${count} items (expected ${allItems.length})`);

  if (count !== allItems.length) {
    console.error(`  WARNING: Item count mismatch!`);
  } else {
    console.log("  Verification passed!");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
