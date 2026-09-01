/**
 * Query SWG Legends resources from DynamoDB.
 *
 * Supports hierarchy-aware class queries: --class Metal returns all
 * Metal subtypes (Iron, Steel, Copper, Aluminum variants), not just
 * resources with resourceClass literally equal to "Metal".
 *
 * Usage:
 *   npm run query -- --planet Tatooine
 *   npm run query -- --class Metal
 *   npm run query -- --class Copper --stat oq --min 800
 *   npm run query -- --planet Tatooine --class Metal
 *   npm run query -- --class "Desh Copper"
 *   npm run query
 *
 * Query patterns:
 *   --planet            Uses by-planet GSI
 *   --class             Uses by-category GSI (hierarchy-aware)
 *   --planet + --class  Uses by-planet GSI + class FilterExpression
 *   --stat + --min      Additional stat threshold filter (on any of the above)
 *   (no filters)        Scans entire table
 */

import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, ScanCommandInput } from "@aws-sdk/lib-dynamodb";
import { createDocClient, RESOURCES_TABLE } from "../config.js";
import type { ResourceItem, StatKey } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";
import { loadClassCache } from "../ingest/load-resources.js";

// ─── Types ───────────────────────────────────────────────────────────

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

// ─── Simple arg parser ───────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

// ─── Hierarchy helpers ───────────────────────────────────────────────

function isLeafNode(className: string, cache: Map<string, ClassInfo>): boolean {
  const info = cache.get(className);
  if (!info) return true;
  const prefix = info.treePath + "/";
  for (const [, node] of cache) {
    if (node.treePath.startsWith(prefix)) return false;
  }
  return true;
}

function findCategory(cache: Map<string, ClassInfo>, treePath: string): string | undefined {
  const segments = treePath.split("/");
  for (const [, node] of cache) {
    if (node.depth === 0 && node.treePath === segments[0]) {
      return node.className;
    }
  }
  return undefined;
}

// ─── Query functions ─────────────────────────────────────────────────

async function queryByPlanet(
  planet: string,
  filterStat?: StatKey,
  minValue?: number
): Promise<ResourceItem[]> {
  const docClient = createDocClient();
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const expressionNames: Record<string, string> = {};
  const input: QueryCommandInput = {
    TableName: RESOURCES_TABLE,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  if (Object.keys(expressionNames).length > 0) {
    input.ExpressionAttributeNames = expressionNames;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

async function queryByClass(
  resourceClass: string,
  filterStat?: StatKey,
  minValue?: number,
  cache?: Map<string, ClassInfo>
): Promise<ResourceItem[]> {
  const docClient = createDocClient();

  // Try hierarchical query
  if (cache) {
    const classInfo = cache.get(resourceClass);
    if (classInfo) {
      const category = findCategory(cache, classInfo.treePath);
      if (category) {
        const input: QueryCommandInput = {
          TableName: RESOURCES_TABLE,
          IndexName: "by-category",
          ExpressionAttributeValues: { ":cat": category },
        };

        if (classInfo.depth === 0) {
          input.KeyConditionExpression = "classCategory = :cat";
        } else if (!isLeafNode(resourceClass, cache)) {
          input.KeyConditionExpression = "classCategory = :cat AND begins_with(classPath, :prefix)";
          (input.ExpressionAttributeValues as Record<string, unknown>)[":prefix"] = classInfo.treePath + "/";
        } else {
          input.KeyConditionExpression = "classCategory = :cat AND classPath = :exact";
          (input.ExpressionAttributeValues as Record<string, unknown>)[":exact"] = classInfo.treePath;
        }

        if (filterStat && minValue !== undefined) {
          input.FilterExpression = "#stat >= :minVal";
          input.ExpressionAttributeNames = { "#stat": filterStat };
          (input.ExpressionAttributeValues as Record<string, unknown>)[":minVal"] = minValue;
        }

        const result = await docClient.send(new QueryCommand(input));
        return (result.Items ?? []) as ResourceItem[];
      }
    }
  }

  // Fallback: exact match on by-class GSI
  const expressionValues: Record<string, unknown> = { ":cls": resourceClass };
  const input: QueryCommandInput = {
    TableName: RESOURCES_TABLE,
    IndexName: "by-class",
    KeyConditionExpression: "resourceClass = :cls",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
    input.ExpressionAttributeNames = { "#stat": filterStat };
    expressionValues[":minVal"] = minValue;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

async function queryByPlanetAndClass(
  planet: string,
  resourceClass: string,
  filterStat?: StatKey,
  minValue?: number,
  cache?: Map<string, ClassInfo>
): Promise<ResourceItem[]> {
  const docClient = createDocClient();
  const expressionValues: Record<string, unknown> = { ":planet": planet };
  const expressionNames: Record<string, string> = {};
  const filterParts: string[] = [];

  // Build class hierarchy filter
  if (cache) {
    const classInfo = cache.get(resourceClass);
    if (classInfo) {
      if (classInfo.depth === 0) {
        filterParts.push("classCategory = :classCategory");
        expressionValues[":classCategory"] = classInfo.className;
      } else if (!isLeafNode(resourceClass, cache)) {
        filterParts.push("begins_with(classPath, :classPrefix)");
        expressionValues[":classPrefix"] = classInfo.treePath + "/";
      } else {
        filterParts.push("classPath = :classPath");
        expressionValues[":classPath"] = classInfo.treePath;
      }
    } else {
      filterParts.push("resourceClass = :cls");
      expressionValues[":cls"] = resourceClass;
    }
  } else {
    filterParts.push("resourceClass = :cls");
    expressionValues[":cls"] = resourceClass;
  }

  if (filterStat && minValue !== undefined) {
    filterParts.push("#stat >= :minVal");
    expressionNames["#stat"] = filterStat;
    expressionValues[":minVal"] = minValue;
  }

  const input: QueryCommandInput = {
    TableName: RESOURCES_TABLE,
    IndexName: "by-planet",
    KeyConditionExpression: "planet = :planet",
    ExpressionAttributeValues: expressionValues,
  };

  if (filterParts.length > 0) {
    input.FilterExpression = filterParts.join(" AND ");
  }
  if (Object.keys(expressionNames).length > 0) {
    input.ExpressionAttributeNames = expressionNames;
  }

  const result = await docClient.send(new QueryCommand(input));
  return (result.Items ?? []) as ResourceItem[];
}

async function scanAll(
  filterStat?: StatKey,
  minValue?: number
): Promise<ResourceItem[]> {
  const docClient = createDocClient();
  const input: ScanCommandInput = { TableName: RESOURCES_TABLE };

  if (filterStat && minValue !== undefined) {
    input.FilterExpression = "#stat >= :minVal";
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

  // Deduplicate by resourceId (resources span multiple planets)
  const seen = new Map<string, ResourceItem>();
  for (const item of items) {
    if (!seen.has(item.resourceId)) {
      seen.set(item.resourceId, item);
    }
  }
  const deduped = [...seen.values()];

  // Determine which stats are present in the results
  const presentStats = ALL_STAT_KEYS.filter((key) =>
    deduped.some((item) => item[key] !== undefined)
  );

  // Column widths
  const nameWidth = Math.max(12, ...deduped.map((i) => i.resourceName.length));
  const classWidth = Math.max(14, ...deduped.map((i) => i.resourceClass.length));
  const catWidth = Math.max(10, ...deduped.map((i) => {
    if (i.classCategory && i.classGroup) return `${i.classCategory}/${i.classGroup}`.length;
    return (i.classCategory ?? "").length;
  }));
  const planetWidth = Math.max(10, ...deduped.map((i) => (i.allPlanets || i.planet).length));
  const statWidth = 5;

  // Header
  const header = [
    "Name".padEnd(nameWidth),
    "Class".padEnd(classWidth),
    "Category".padEnd(catWidth),
    "Planets".padEnd(planetWidth),
    ...presentStats.map((s) => s.toUpperCase().padStart(statWidth)),
  ].join("  ");

  const separator = "-".repeat(header.length);

  console.log(`\n  ${header}`);
  console.log(`  ${separator}`);

  // Sort by first present stat descending
  const sortStat = presentStats[0];
  if (sortStat) {
    deduped.sort((a, b) => (b[sortStat] ?? 0) - (a[sortStat] ?? 0));
  }

  for (const item of deduped) {
    const category = item.classCategory && item.classGroup
      ? `${item.classCategory}/${item.classGroup}`
      : item.classCategory ?? "";

    const row = [
      item.resourceName.padEnd(nameWidth),
      item.resourceClass.padEnd(classWidth),
      category.padEnd(catWidth),
      (item.allPlanets || item.planet).padEnd(planetWidth),
      ...presentStats.map((s) =>
        item[s] !== undefined
          ? String(item[s]).padStart(statWidth)
          : "-".padStart(statWidth)
      ),
    ].join("  ");
    console.log(`  ${row}`);
  }

  console.log(`\n  ${deduped.length} resources (${items.length} items)\n`);
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

  // Load classification cache for hierarchy-aware class queries
  console.log("  Loading classification cache...");
  const classCache = await loadClassCache();
  console.log(`  ${classCache.size} classes loaded`);

  // Show what we're querying
  const filters: string[] = [];
  if (planet) filters.push(`planet=${planet}`);
  if (resourceClass) {
    const classInfo = classCache.get(resourceClass);
    if (classInfo && !isLeafNode(resourceClass, classCache)) {
      filters.push(`class="${resourceClass}" (hierarchy: includes all subtypes)`);
    } else {
      filters.push(`class="${resourceClass}"`);
    }
  }
  if (statFilter && minValue !== undefined)
    filters.push(`${statFilter.toUpperCase()} >= ${minValue}`);
  console.log(
    filters.length > 0
      ? `  Filters: ${filters.join(", ")}`
      : "  No filters (scanning all resources)"
  );

  let items: ResourceItem[];

  if (planet && resourceClass) {
    items = await queryByPlanetAndClass(planet, resourceClass, statFilter, minValue, classCache);
  } else if (planet) {
    items = await queryByPlanet(planet, statFilter, minValue);
  } else if (resourceClass) {
    items = await queryByClass(resourceClass, statFilter, minValue, classCache);
  } else {
    items = await scanAll(statFilter, minValue);
  }

  printResults(items);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
