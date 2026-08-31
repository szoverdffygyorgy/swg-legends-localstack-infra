/**
 * Query SWG Legends resources from DynamoDB.
 *
 * This script demonstrates the three main DynamoDB query patterns:
 *
 * 1. Query by planet (uses the by-planet GSI)
 *    npx tsx src/query/find-resources.ts --planet Tatooine
 *
 * 2. Query by resource class (uses the by-class GSI)
 *    npx tsx src/query/find-resources.ts --class "Reactive Gas"
 *
 * 3. Filter by stat threshold (applied on top of either query)
 *    npx tsx src/query/find-resources.ts --planet Tatooine --stat oq --min 800
 *
 * 4. No filters = scan entire table (expensive in real AWS, fine for LocalStack)
 *    npx tsx src/query/find-resources.ts
 *
 * DynamoDB query vs scan:
 * - Query: reads items matching a specific partition key. Fast and cheap.
 *   Only works if you're querying by a key or GSI key.
 * - Scan: reads EVERY item in the table, then filters. Slow and expensive
 *   on large tables. Fine for our 831 items, bad for millions.
 * - FilterExpression: applied AFTER reading. It reduces the items returned
 *   to you, but DynamoDB still reads (and charges for) all items that
 *   match the key condition. Stat filters use this.
 */

import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, ScanCommandInput, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocClient, RESOURCES_TABLE } from "../config.js";
import type { ResourceItem, StatKey } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

// ─── Simple arg parser ───────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

// ─── Query functions ─────────────────────────────────────────────────

async function queryByPlanet(
  docClient: DynamoDBDocumentClient,
  planet: string,
  filterStat?: StatKey,
  minValue?: number
): Promise<ResourceItem[]> {
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const input: QueryCommandInput = {
    TableName: RESOURCES_TABLE,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = `#stat >= :minVal`;
    input.ExpressionAttributeNames = { "#stat": filterStat };
    expressionValues[":minVal"] = minValue;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

async function queryByClass(
  docClient: DynamoDBDocumentClient,
  resourceClass: string,
  filterStat?: StatKey,
  minValue?: number
): Promise<ResourceItem[]> {
  const expressionValues: Record<string, unknown> = { ":cls": resourceClass };
  const input: QueryCommandInput = {
    TableName: RESOURCES_TABLE,
    IndexName: "by-class",
    KeyConditionExpression: "resourceClass = :cls",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = `#stat >= :minVal`;
    input.ExpressionAttributeNames = { "#stat": filterStat };
    expressionValues[":minVal"] = minValue;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

async function scanAll(
  docClient: DynamoDBDocumentClient,
  filterStat?: StatKey,
  minValue?: number
): Promise<ResourceItem[]> {
  const input: ScanCommandInput = {
    TableName: RESOURCES_TABLE,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = `#stat >= :minVal`;
    input.ExpressionAttributeNames = { "#stat": filterStat };
    input.ExpressionAttributeValues = { ":minVal": minValue };
  }

  const result = await docClient.send(new ScanCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

// ─── Pretty printer ──────────────────────────────────────────────────

function printResults(items: ResourceItem[]): void {
  if (items.length === 0) {
    console.log("  No resources found matching your criteria.\n");
    return;
  }

  // Determine which stats are present in the results
  const presentStats = ALL_STAT_KEYS.filter((key) =>
    items.some((item) => item[key] !== undefined)
  );

  // Column widths
  const nameWidth = Math.max(12, ...items.map((i) => i.resourceName.length));
  const classWidth = Math.max(14, ...items.map((i) => i.resourceClass.length));
  const planetWidth = Math.max(10, ...items.map((i) => i.planet.length));
  const statWidth = 5;

  // Header
  const header = [
    "Name".padEnd(nameWidth),
    "Class".padEnd(classWidth),
    "Planet".padEnd(planetWidth),
    ...presentStats.map((s) => s.toUpperCase().padStart(statWidth)),
  ].join("  ");

  const separator = "-".repeat(header.length);

  console.log(`\n  ${header}`);
  console.log(`  ${separator}`);

  // Sort by first present stat descending (so best resources appear first)
  const sortStat = presentStats[0];
  if (sortStat) {
    items.sort((a, b) => (b[sortStat] ?? 0) - (a[sortStat] ?? 0));
  }

  for (const item of items) {
    const row = [
      item.resourceName.padEnd(nameWidth),
      item.resourceClass.padEnd(classWidth),
      item.planet.padEnd(planetWidth),
      ...presentStats.map((s) =>
        item[s] !== undefined
          ? String(item[s]).padStart(statWidth)
          : "-".padStart(statWidth)
      ),
    ].join("  ");
    console.log(`  ${row}`);
  }

  console.log(`\n  ${items.length} results\n`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const planet = getArg("planet");
  const resourceClass = getArg("class");
  const statFilter = getArg("stat") as StatKey | undefined;
  const minValueStr = getArg("min");
  const minValue = minValueStr ? Number(minValueStr) : undefined;

  // Validate stat filter
  if (statFilter && !ALL_STAT_KEYS.includes(statFilter)) {
    console.error(
      `Invalid stat: "${statFilter}". Valid stats: ${ALL_STAT_KEYS.join(", ")}`
    );
    process.exit(1);
  }

  console.log("=== SWG Legends Resource Query ===\n");

  // Show what we're querying
  const filters: string[] = [];
  if (planet) filters.push(`planet=${planet}`);
  if (resourceClass) filters.push(`class="${resourceClass}"`);
  if (statFilter && minValue !== undefined)
    filters.push(`${statFilter.toUpperCase()} >= ${minValue}`);
  console.log(
    filters.length > 0
      ? `  Filters: ${filters.join(", ")}`
      : "  No filters (scanning all resources)"
  );

  const docClient = createDocClient();
  let items: ResourceItem[];

  if (planet) {
    items = await queryByPlanet(docClient, planet, statFilter, minValue);
  } else if (resourceClass) {
    items = await queryByClass(docClient, resourceClass, statFilter, minValue);
  } else {
    items = await scanAll(docClient, statFilter, minValue);
  }

  printResults(items);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
