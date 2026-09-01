/**
 * Alert evaluator: processes spawn events from SQS, checks alert rules.
 *
 * This consumer reads messages from the alert-evaluator SQS queue
 * (fed by the resource-spawned SNS topic) and checks each new resource
 * against user-defined alert rules in the alert-rules DynamoDB table.
 *
 * When a rule matches, a "FIRED" item is written to the alert-rules
 * table, recording which rule matched, what resource triggered it,
 * and when.
 *
 * Matching logic:
 * - classPattern: hierarchy-aware. "Metal" matches all metal subtypes.
 *   Falls back to substring matching if the class isn't in the hierarchy.
 * - statThresholds: map of stat -> minValue. ALL must be met (AND).
 *   Legacy rules with single stat/minValue are normalized.
 * - planets: if set, resource must spawn on at least one listed planet (OR).
 *   If empty/absent, any planet matches.
 *
 * Run with: npm run process:alerts
 */

import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  createSQSClient,
  createDocClient,
  ALERT_EVALUATOR_QUEUE_URL,
  ALERT_RULES_TABLE,
} from "../config.js";
import { loadClassCache } from "../ingest/load-resources.js";

// ANSI colors
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

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
  statThresholds?: Record<string, number>;
  planets?: string[];
  // Legacy format
  stat?: string;
  minValue?: number;
  enabled: boolean;
}

interface ClassInfo {
  treePath: string;
  className: string;
  depth: number;
}

/**
 * Fetch all enabled alert rules from DynamoDB.
 */
async function fetchAlertRules(): Promise<AlertRule[]> {
  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERT_RULES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );

  return ((result.Items ?? []) as AlertRule[]).filter((r) => r.enabled);
}

/**
 * Check if a spawned resource matches an alert rule.
 * Uses hierarchy-aware class matching, multiple stat thresholds, and planet filter.
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
      const isExact = resourceInfo.treePath === ruleInfo.treePath;
      const isDescendant = resourceInfo.treePath.startsWith(ruleInfo.treePath + "/");
      if (!isExact && !isDescendant) return false;
    } else {
      // Fallback: substring match for unrecognized classes
      if (!resource.resourceClass.toLowerCase().includes(rule.classPattern.toLowerCase())) {
        return false;
      }
    }
  }

  // 2. Stat thresholds (AND -- all must pass)
  const thresholds = rule.statThresholds ??
    (rule.stat && rule.minValue !== undefined ? { [rule.stat]: rule.minValue } : {});

  for (const [stat, minVal] of Object.entries(thresholds)) {
    const val = resource.stats[stat];
    if (val === undefined || val < minVal) return false;
  }

  // 3. Planet filter (OR -- resource on at least one listed planet)
  if (rule.planets && rule.planets.length > 0) {
    const rulePlanets = new Set(rule.planets);
    if (!resource.planets.some((p) => rulePlanets.has(p))) return false;
  }

  return true;
}

/**
 * Record a fired alert in the alert-rules table.
 */
async function recordFiredAlert(
  resource: SpawnMessage,
  rule: AlertRule
): Promise<void> {
  const docClient = createDocClient();
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: ALERT_RULES_TABLE,
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

/**
 * Format a rule for display.
 */
function formatRule(rule: AlertRule): string {
  const thresholds = rule.statThresholds ??
    (rule.stat && rule.minValue !== undefined ? { [rule.stat]: rule.minValue } : {});

  const statInfo = Object.entries(thresholds)
    .map(([k, v]) => `${k.toUpperCase()}>=${v}`)
    .join(" ");

  const planetInfo = rule.planets?.length
    ? ` planets=[${rule.planets.join(", ")}]`
    : "";

  return `${rule.name}: class="${rule.classPattern}"${statInfo ? " " + statInfo : ""}${planetInfo}`;
}

async function main(): Promise<void> {
  const sqs = createSQSClient();

  console.log("=== Alert Evaluator: Processing Spawn Events ===\n");

  // Load classification cache
  console.log("  Loading classification cache...");
  const cache = await loadClassCache();
  console.log(`  Classification cache: ${cache.size} classes`);

  // Fetch alert rules
  console.log("  Loading alert rules...");
  const rules = await fetchAlertRules();
  console.log(`  ${rules.length} active rules loaded`);

  if (rules.length === 0) {
    console.log(
      `\n  ${YELLOW}No alert rules defined. Add rules with: npm run alerts:add${RESET}\n`
    );
  }

  for (const rule of rules) {
    console.log(`    - ${formatRule(rule)}`);
  }
  console.log();

  console.log(`  Queue: ${ALERT_EVALUATOR_QUEUE_URL}\n`);

  let totalProcessed = 0;
  let totalMatches = 0;
  let emptyPolls = 0;

  while (emptyPolls < 2) {
    const response = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: ALERT_EVALUATOR_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 3,
      })
    );

    const messages = response.Messages ?? [];

    if (messages.length === 0) {
      emptyPolls++;
      continue;
    }
    emptyPolls = 0;

    for (const message of messages) {
      try {
        const body: SpawnMessage = JSON.parse(message.Body ?? "{}");

        // Check against all rules
        for (const rule of rules) {
          if (matchesRule(body, rule, cache)) {
            await recordFiredAlert(body, rule);
            totalMatches++;

            const statsStr = Object.entries(body.stats)
              .map(([k, v]) => `${k.toUpperCase()}:${v}`)
              .join(" ");

            console.log(
              `  ${BOLD}${RED}ALERT${RESET} ${YELLOW}[${rule.name}]${RESET} ` +
                `${GREEN}${body.resourceName}${RESET} (${body.resourceClass}) ` +
                `[${body.planets.join(", ")}] ${statsStr}`
            );
          }
        }

        // Delete message from queue
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: ALERT_EVALUATOR_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          })
        );

        totalProcessed++;
      } catch (err) {
        console.error(
          `  Failed to process message ${message.MessageId}:`,
          err
        );
      }
    }
  }

  console.log(
    `\nDone: ${totalProcessed} messages processed, ${totalMatches} alerts fired`
  );
}

main().catch((err) => {
  console.error("Alert evaluator failed:", err);
  process.exit(1);
});
