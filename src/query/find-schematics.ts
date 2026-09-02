/**
 * Query schematics from DynamoDB.
 *
 * Usage:
 *   npm run schematics:query -- --name Mabari       Search by name substring
 *   npm run schematics:query -- --class Metal        Find schematics using Metal
 *   npm run schematics:query -- --class Copper       Find schematics using Copper
 *   npm run schematics:query -- --category 767       Browse by category
 *   npm run schematics:query -- --id 1717            Get specific schematic
 *   npm run schematics:query                         Show table stats
 */

import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, SCHEMATICS_TABLE } from "../config.js";

// ─── Arg parser ──────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

// ─── Queries ─────────────────────────────────────────────────────────

const docClient = createDocClient();

async function getById(id: string): Promise<void> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: SCHEMATICS_TABLE,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: { ":pk": `SCHEM#${id}`, ":sk": "META" },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log(`  No schematic found with ID ${id}`);
    return;
  }

  const s = result.Items[0];
  printSchematic(s);
}

async function searchByName(name: string): Promise<void> {
  // Scan with filter -- fine for ~3,673 metadata items
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: SCHEMATICS_TABLE,
        FilterExpression: "begins_with(pk, :prefix) AND contains(#n, :name)",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":prefix": "SCHEM#", ":name": name },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  Found ${items.length} schematics matching "${name}":\n`);
  for (const s of items.slice(0, 20)) {
    printSchematicBrief(s);
  }
  if (items.length > 20) {
    console.log(`  ... and ${items.length - 20} more`);
  }
}

async function findByClass(className: string): Promise<void> {
  // Query the ingredient class index
  const result = await docClient.send(
    new QueryCommand({
      TableName: SCHEMATICS_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `CLASS#${className}` },
    })
  );

  const items = result.Items ?? [];
  console.log(`  Found ${items.length} schematics using "${className}":\n`);
  for (const item of items.slice(0, 30)) {
    console.log(`    [${item.base}] ${item.schematicName} (ID: ${item.schematicId}, category: ${item.category})`);
  }
  if (items.length > 30) {
    console.log(`    ... and ${items.length - 30} more`);
  }
}

async function browseCategory(category: string): Promise<void> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: SCHEMATICS_TABLE,
      IndexName: "by-category",
      KeyConditionExpression: "category = :cat",
      ExpressionAttributeValues: { ":cat": category },
    })
  );

  const items = result.Items ?? [];
  console.log(`  Found ${items.length} schematics in category ${category}:\n`);
  for (const s of items.slice(0, 30)) {
    printSchematicBrief(s);
  }
  if (items.length > 30) {
    console.log(`    ... and ${items.length - 30} more`);
  }
}

async function showStats(): Promise<void> {
  let totalItems = 0;
  let metaItems = 0;
  let classItems = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: SCHEMATICS_TABLE,
        ProjectionExpression: "pk",
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of result.Items ?? []) {
      totalItems++;
      if ((item.pk as string).startsWith("SCHEM#")) metaItems++;
      else if ((item.pk as string).startsWith("CLASS#")) classItems++;
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log("  Table statistics:");
  console.log(`    Total items:          ${totalItems}`);
  console.log(`    Schematic metadata:   ${metaItems}`);
  console.log(`    Class index entries:  ${classItems}`);
  console.log("");
  console.log("  Usage:");
  console.log("    npm run schematics:query -- --name Mabari");
  console.log("    npm run schematics:query -- --class Metal");
  console.log("    npm run schematics:query -- --category 767");
  console.log("    npm run schematics:query -- --id 1717");
}

// ─── Helpers ─────────────────────────────────────────────────────────

function printSchematic(s: Record<string, unknown>): void {
  console.log(`  ${s.name} (ID: ${s.schematicId})`);
  console.log(`    Base: ${s.base} | Category: ${s.category} | Quality: ${s.quality}`);
  console.log(`    Complexity: ${s.complexity} | XP: ${s.xp} | Manufacturable: ${s.manufacture}`);
  if (s.description) {
    const desc = String(s.description);
    console.log(`    "${desc.slice(0, 100)}${desc.length > 100 ? "..." : ""}"`);
  }

  const ingredients = s.ingredients as Array<Record<string, unknown>> | undefined;
  if (ingredients?.length) {
    console.log("    Ingredients:");
    for (const ing of ingredients) {
      if (ing.type === "resource") {
        console.log(`      ${ing.units} x ${ing.className ?? `[${ing.classId}]`} (${ing.desc})`);
      } else {
        console.log(`      ${ing.count} x [${ing.componentType}] ${ing.componentId} (${ing.desc})`);
      }
    }
  }

  const expGroups = s.experimentalGroups as Array<Record<string, unknown>> | undefined;
  if (expGroups?.length) {
    console.log("    Experiments:");
    for (const grp of expGroups) {
      const props = grp.properties as Array<Record<string, unknown>>;
      for (const prop of props) {
        const weights = prop.weights as Record<string, number>;
        const weightStr = Object.entries(weights)
          .map(([k, v]) => `${k.toUpperCase()}=${v}%`)
          .join(", ");
        console.log(`      ${grp.group} > ${prop.name}: ${weightStr}`);
      }
    }
  }
  console.log("");
}

function printSchematicBrief(s: Record<string, unknown>): void {
  const ingCount = (s.ingredients as unknown[])?.length ?? 0;
  const expCount = (s.experimentalGroups as unknown[])?.length ?? 0;
  console.log(`    [${s.base}] ${s.name} (ID: ${s.schematicId}, cat: ${s.category}, ${ingCount} ingredients, ${expCount} exp groups)`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Query Schematics ===\n");

  const id = getArg("id");
  const name = getArg("name");
  const className = getArg("class");
  const category = getArg("category");

  if (id) {
    await getById(id);
  } else if (name) {
    await searchByName(name);
  } else if (className) {
    await findByClass(className);
  } else if (category) {
    await browseCategory(category);
  } else {
    await showStats();
  }
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
