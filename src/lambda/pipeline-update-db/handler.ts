/**
 * Pipeline Lambda: Update DynamoDB
 *
 * Step 4 of the ingestion state machine.
 * Reads the diff from S3, adds spawned resources and removes despawned
 * resources from the resources DynamoDB table.
 *
 * Enriches each spawned resource with classification data (hierarchy path,
 * category, group) by looking up the resource class in the resource-classes
 * table. The classification cache is loaded on cold start and reused across
 * invocations within the same Lambda container.
 *
 * Input:  { diffS3Key: string, xmlS3Key: string, spawnedCount: number, ... }
 * Output: { ...input, itemsAdded: number, itemsRemoved: number }
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const RESOURCES_TABLE = process.env.RESOURCES_TABLE || "resources";
const RESOURCE_CLASSES_TABLE = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE || "event-log";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const BATCH_SIZE = 25;

const ALL_STAT_KEYS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Types ───────────────────────────────────────────────────────────

interface UpdateInput {
  diffS3Key: string;
  xmlS3Key: string;
  spawnedCount: number;
  despawnedCount: number;
  unchangedCount: number;
  dataIssueCount: number;
  hasChanges: boolean;
}

interface UpdateOutput extends UpdateInput {
  itemsAdded: number;
  itemsRemoved: number;
  unclassifiedCount: number;
}

interface SWGResource {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  stats: Record<string, number>;
  planets: string[];
  availableTimestamp: number;
  availableBy: string;
}

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

// ─── Classification cache ────────────────────────────────────────────
// Loaded once on cold start, reused across invocations.
// Maps className (e.g., "Desh Copper") -> classification data.

let classCache: Map<string, ClassInfo> | null = null;

async function loadClassCache(): Promise<Map<string, ClassInfo>> {
  if (classCache) return classCache;

  console.log(`Loading classification cache from ${RESOURCE_CLASSES_TABLE}...`);
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

  console.log(`Classification cache loaded: ${cache.size} classes`);
  classCache = cache;
  return cache;
}

/**
 * Extract classification fields from a treePath.
 * Path format: "inorganic/mineral/metal/non-ferrous_metal/copper/desh_copper"
 *
 * Returns { classPath, classCategory, classGroup } or undefined fields
 * if the class is not found in the hierarchy.
 */
function getClassification(
  cache: Map<string, ClassInfo>,
  resourceClass: string
): { classPath: string; classCategory: string; classGroup: string } | null {
  const info = cache.get(resourceClass);
  if (!info) return null;

  const segments = info.treePath.split("/");

  // Category = root level (depth 0), e.g., "inorganic" -> "Inorganic"
  // Group = second level (depth 1), e.g., "mineral" -> "Mineral"
  // We need to look up the actual classNames for proper casing.
  // Since the path uses slugs, we find the matching nodes by their path prefix.
  // For simplicity, we look up by iterating the cache for nodes at depth 0 and 1
  // whose slug matches the path segment. But that's expensive.
  //
  // Simpler approach: capitalize the slug segments back to readable names.
  // But this loses proper casing (e.g., "non-ferrous_metal" -> ???).
  //
  // Best approach: look up category and group from the cache directly.
  // The category node's className matches the first path segment,
  // and the group node's className matches the second.

  let category: string | undefined;
  let group: string | undefined;

  if (segments.length >= 1) {
    // Find the root node whose treePath equals the first segment
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

// ─── Denormalize (same logic as load-resources.ts) ───────────────────

function denormalize(
  resource: SWGResource,
  cache: Map<string, ClassInfo>
): Record<string, unknown>[] {
  const classification = getClassification(cache, resource.resourceClass);

  const base: Record<string, unknown> = {
    resourceId: resource.resourceId,
    resourceName: resource.resourceName,
    resourceClass: resource.resourceClass,
    resourceClassId: resource.resourceClassId,
    allPlanets: resource.planets.join(", "),
    availableTimestamp: resource.availableTimestamp,
    availableBy: resource.availableBy,
  };

  // Add classification fields if available
  if (classification) {
    base.classPath = classification.classPath;
    base.classCategory = classification.classCategory;
    base.classGroup = classification.classGroup;
  }

  const statsFlat: Record<string, number> = {};
  for (const key of ALL_STAT_KEYS) {
    if (resource.stats[key] !== undefined) {
      statsFlat[key] = resource.stats[key];
    }
  }

  return resource.planets.map((planet) => ({
    ...base,
    ...statsFlat,
    planet,
  }));
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: UpdateInput): Promise<UpdateOutput> {
  console.log(`Step 4: Updating DynamoDB`);

  // Load classification cache (cached across invocations)
  const cache = await loadClassCache();

  // Read diff from S3
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.diffS3Key })
  );
  const diff = JSON.parse(await s3Response.Body!.transformToString("utf-8"));

  let itemsAdded = 0;
  let itemsRemoved = 0;
  const unclassifiedClasses = new Set<string>();

  // Add spawned resources (enriched with classification)
  if (diff.spawned.length > 0) {
    const items = diff.spawned.flatMap((r: SWGResource) => denormalize(r, cache));
    console.log(`Adding ${diff.spawned.length} resources (${items.length} items)`);

    // Track which resource classes couldn't be classified
    for (const r of diff.spawned as SWGResource[]) {
      if (!cache.has(r.resourceClass)) {
        unclassifiedClasses.add(r.resourceClass);
      }
    }

    if (unclassifiedClasses.size > 0) {
      console.warn(
        `Warning: ${unclassifiedClasses.size} unknown resource class(es): ${[...unclassifiedClasses].join(", ")}`
      );
    }

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [RESOURCES_TABLE]: batch.map((item: Record<string, unknown>) => ({
              PutRequest: { Item: item },
            })),
          },
        })
      );
      itemsAdded += batch.length;
    }
  }

  // Remove despawned resources
  if (diff.despawned.length > 0) {
    console.log(`Removing ${event.despawnedCount} resources (${diff.despawned.length} items)`);

    for (let i = 0; i < diff.despawned.length; i += BATCH_SIZE) {
      const batch = diff.despawned.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [RESOURCES_TABLE]: batch.map(
              (item: { resourceId: string; planet: string }) => ({
                DeleteRequest: {
                  Key: { resourceId: item.resourceId, planet: item.planet },
                },
              })
            ),
          },
        })
      );
      itemsRemoved += batch.length;
    }
  }

  console.log(`DynamoDB updated: ${itemsAdded} added, ${itemsRemoved} removed`);

  // Write DATA_ISSUE events for unclassified resource classes
  if (unclassifiedClasses.size > 0) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timestamp = now.toISOString();

    console.log(`Writing ${unclassifiedClasses.size} DATA_ISSUE event(s) for unclassified classes`);

    for (const className of unclassifiedClasses) {
      await docClient.send(
        new PutCommand({
          TableName: EVENT_LOG_TABLE,
          Item: {
            date: dateStr,
            sk: `${timestamp}#UNCLASSIFIED#${className}`,
            eventType: "DATA_ISSUE",
            resourceId: "N/A",
            resourceName: "N/A",
            resourceClass: className,
            planets: "",
            statSummary: "",
            detectedAt: timestamp,
            issue: `Resource class "${className}" not found in classification hierarchy. The game may have been patched with new resource types. Re-scrape with: npm run scrape:tree && npm run seed:classes`,
          },
        })
      );
    }
  }

  return { ...event, itemsAdded, itemsRemoved, unclassifiedCount: unclassifiedClasses.size };
}
