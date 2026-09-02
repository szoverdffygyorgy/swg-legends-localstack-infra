/**
 * Lambda handler: History Recorder
 *
 * Triggered automatically by SQS when messages arrive in the
 * history-recorder queue. Each invocation receives a batch of
 * despawn event messages.
 *
 * For each despawned resource:
 * 1. Enrich with classification data (classPath, classCategory, classGroup)
 * 2. Flatten stats to top-level attributes for DynamoDB filtering
 * 3. Write to the resource-history DynamoDB table
 *
 * This preserves a record of every resource that has ever existed
 * on the server, enabling queries like "show me all past spawns
 * of Desh Copper" or "what resources despawned this week?"
 *
 * Environment variables (set in OpenTofu):
 * - LOCALSTACK_ENDPOINT: LocalStack URL (for DynamoDB client)
 * - AWS_REGION_CUSTOM: AWS region
 * - RESOURCE_HISTORY_TABLE: DynamoDB table name for history
 * - RESOURCE_CLASSES_TABLE: DynamoDB table name for class hierarchy
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

// ─── Types ───────────────────────────────────────────────────────────

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSRecord {
  messageId: string;
  body: string;
}

interface DespawnMessage {
  eventType: "DESPAWNED";
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string[];
  stats: Record<string, number>;
  availableTimestamp: number;
  availableBy: string;
}

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.RESOURCE_HISTORY_TABLE || "resource-history";
const classesTableName = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Classification cache ────────────────────────────────────────────
// Loaded on cold start, cached across invocations.

let classCache: Map<string, ClassInfo> | null = null;

async function loadClassCache(): Promise<Map<string, ClassInfo>> {
  if (classCache) return classCache;

  console.log(`Loading classification cache from ${classesTableName}...`);
  const cache = new Map<string, ClassInfo>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: classesTableName,
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
 * Extract classification fields from a class name using the hierarchy cache.
 * Returns { classPath, classCategory, classGroup } or null if not found.
 */
function getClassification(
  cache: Map<string, ClassInfo>,
  resourceClass: string
): { classPath: string; classCategory: string; classGroup: string } | null {
  const info = cache.get(resourceClass);
  if (!info) return null;

  const segments = info.treePath.split("/");

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

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<void> {
  const now = new Date().toISOString();
  console.log(`History recorder invoked with ${event.Records.length} record(s)`);

  // Load classification cache (cached across invocations)
  const cache = await loadClassCache();

  let recorded = 0;

  for (const record of event.Records) {
    try {
      const body: DespawnMessage = JSON.parse(record.body);
      console.log(`Recording despawn: ${body.resourceName} (${body.resourceClass})`);

      // Enrich with classification data
      const classification = getClassification(cache, body.resourceClass);

      // Build item with flattened stats for DynamoDB FilterExpression support
      const item: Record<string, unknown> = {
        resourceId: body.resourceId,
        despawnedAt: now,
        resourceName: body.resourceName,
        resourceClass: body.resourceClass,
        resourceClassId: body.resourceClassId,
        planets: body.planets.join(", "),
        availableTimestamp: body.availableTimestamp,
        availableBy: body.availableBy,
      };

      // Add classification fields (enables by-category GSI queries)
      if (classification) {
        item.classPath = classification.classPath;
        item.classCategory = classification.classCategory;
        item.classGroup = classification.classGroup;
      }

      // Flatten stats to top-level attributes (enables stat filter expressions)
      for (const [key, value] of Object.entries(body.stats)) {
        item[key] = value;
      }

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
        })
      );

      recorded++;
    } catch (err) {
      console.error(`Failed to process message ${record.messageId}:`, err);
      throw err; // Re-throw so Lambda retries this batch
    }
  }

  console.log(`Done: ${recorded} despawned resources archived to history table`);
}
