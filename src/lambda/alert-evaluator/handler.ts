/**
 * Lambda handler: Alert Evaluator
 *
 * Triggered automatically by SQS when messages arrive in the
 * alert-evaluator queue. Each invocation receives a batch of
 * spawn event messages.
 *
 * For each spawned resource:
 * 1. Fetch all enabled alert rules from DynamoDB
 * 2. Check if the resource matches any rule (hierarchy-aware class
 *    matching, multiple stat thresholds, planet filter)
 * 3. If matched, write a FIRED alert to the alert-rules table
 *
 * Matching logic:
 * - classPattern: hierarchy-aware. "Metal" matches all metal subtypes.
 *   Falls back to substring matching if the class isn't in the hierarchy.
 * - statThresholds: map of stat -> minValue. ALL must be met (AND).
 *   Legacy rules with single stat/minValue are normalized.
 * - planets: if set, resource must spawn on at least one listed planet (OR).
 *   If empty/absent, any planet matches.
 *
 * Environment variables (set in OpenTofu):
 * - LOCALSTACK_ENDPOINT: LocalStack URL (for DynamoDB client)
 * - AWS_REGION_CUSTOM: AWS region
 * - ALERT_RULES_TABLE: DynamoDB table name for alert rules
 * - RESOURCE_CLASSES_TABLE: DynamoDB table name for class hierarchy
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
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

interface SpawnMessage {
  eventType: "SPAWNED";
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string[];
  stats: Record<string, number>;
  availableTimestamp: number;
  availableBy: string;
}

interface AlertRule {
  pk: string;
  sk: string;
  name: string;
  classPattern: string;
  // New format
  statThresholds?: Record<string, number>;
  planets?: string[];
  // Legacy format (normalized at read time)
  stat?: string;
  minValue?: number;
  enabled: boolean;
}

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const alertsTableName = process.env.ALERT_RULES_TABLE || "alert-rules";
const classesTableName = process.env.RESOURCE_CLASSES_TABLE || "resource-classes";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Classification cache ────────────────────────────────────────────
// Loaded once on cold start, reused across invocations.

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

// ─── Business logic ──────────────────────────────────────────────────

async function fetchAlertRules(): Promise<AlertRule[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: alertsTableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );
  return ((result.Items ?? []) as AlertRule[]).filter((r) => r.enabled);
}

/**
 * Check if a spawned resource matches an alert rule.
 *
 * 1. Class check: hierarchy-aware (resource must be a descendant of
 *    or equal to the rule's classPattern). Falls back to substring
 *    matching if the class isn't in the hierarchy.
 * 2. Stat check: all statThresholds must be met (AND logic).
 * 3. Planet check: if rule.planets is set, resource must be on at
 *    least one listed planet (OR logic).
 */
function matchesRule(
  resource: SpawnMessage,
  rule: AlertRule,
  cache: Map<string, ClassInfo>
): boolean {
  // 1. Class check (hierarchy-aware)
  if (rule.classPattern) {
    const ruleInfo = cache.get(rule.classPattern);
    const resourceInfo = cache.get(resource.resourceClass);

    if (ruleInfo && resourceInfo) {
      // Hierarchy match: resource's path must be or start with rule's path
      const isExact = resourceInfo.treePath === ruleInfo.treePath;
      const isDescendant = resourceInfo.treePath.startsWith(ruleInfo.treePath + "/");
      if (!isExact && !isDescendant) return false;
    } else {
      // Fallback: substring match (for unrecognized class names)
      if (!resource.resourceClass.toLowerCase().includes(rule.classPattern.toLowerCase())) {
        return false;
      }
    }
  }

  // 2. Stat thresholds (AND -- all must pass)
  // Normalize legacy single stat/minValue to statThresholds map
  const thresholds = rule.statThresholds ??
    (rule.stat && rule.minValue !== undefined ? { [rule.stat]: rule.minValue } : {});

  for (const [stat, minVal] of Object.entries(thresholds)) {
    const val = resource.stats[stat];
    if (val === undefined || val < minVal) return false;
  }

  // 3. Planet filter (OR -- resource must be on at least one listed planet)
  if (rule.planets && rule.planets.length > 0) {
    const rulePlanets = new Set(rule.planets);
    if (!resource.planets.some((p) => rulePlanets.has(p))) return false;
  }

  return true;
}

async function recordFiredAlert(resource: SpawnMessage, rule: AlertRule): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: alertsTableName,
      Item: {
        pk: "FIRED",
        sk: `${now}#${rule.sk}`,
        ruleId: rule.sk,
        ruleName: rule.name,
        resourceId: resource.resourceId,
        resourceName: resource.resourceName,
        resourceClass: resource.resourceClass,
        planets: resource.planets.join(", "),
        stats: resource.stats,
        matchedAt: now,
      },
    })
  );
}

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<void> {
  console.log(`Alert evaluator invoked with ${event.Records.length} record(s)`);

  // Load classification cache (cached across invocations)
  const cache = await loadClassCache();

  const rules = await fetchAlertRules();
  console.log(`Loaded ${rules.length} active alert rules`);

  if (rules.length === 0) {
    console.log("No alert rules defined, skipping evaluation");
    return;
  }

  let totalMatches = 0;

  for (const record of event.Records) {
    try {
      const body: SpawnMessage = JSON.parse(record.body);
      console.log(`Evaluating: ${body.resourceName} (${body.resourceClass})`);

      for (const rule of rules) {
        if (matchesRule(body, rule, cache)) {
          await recordFiredAlert(body, rule);
          totalMatches++;
          console.log(`  ALERT FIRED: [${rule.name}] matched ${body.resourceName}`);
        }
      }
    } catch (err) {
      console.error(`Failed to process message ${record.messageId}:`, err);
      throw err; // Re-throw so Lambda retries this batch
    }
  }

  console.log(`Done: ${event.Records.length} messages processed, ${totalMatches} alerts fired`);
}
