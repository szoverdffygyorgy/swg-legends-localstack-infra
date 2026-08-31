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
 * Alert rule format (in DynamoDB):
 *   { pk: "RULE", sk: "r_001", name: "Good Copper",
 *     classPattern: "Copper", stat: "oq", minValue: 900, enabled: true }
 *
 * Matching logic:
 * - classPattern: case-insensitive substring match against resourceClass
 * - stat + minValue: resource must have that stat >= minValue
 * - Both conditions must be true (AND)
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
import type { StatKey } from "../types.js";

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
  stat?: string;
  minValue?: number;
  enabled: boolean;
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
 */
function matchesRule(resource: SpawnMessage, rule: AlertRule): boolean {
  // Check class pattern (case-insensitive substring)
  if (rule.classPattern) {
    const matches = resource.resourceClass
      .toLowerCase()
      .includes(rule.classPattern.toLowerCase());
    if (!matches) return false;
  }

  // Check stat threshold
  if (rule.stat && rule.minValue !== undefined) {
    const statValue = resource.stats[rule.stat as StatKey];
    if (statValue === undefined || statValue < rule.minValue) return false;
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

async function main(): Promise<void> {
  const sqs = createSQSClient();

  console.log("=== Alert Evaluator: Processing Spawn Events ===\n");

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
    const statInfo =
      rule.stat && rule.minValue !== undefined
        ? ` ${rule.stat.toUpperCase()}>=${rule.minValue}`
        : "";
    console.log(
      `    - ${rule.name}: class="${rule.classPattern}"${statInfo}`
    );
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
          if (matchesRule(body, rule)) {
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
