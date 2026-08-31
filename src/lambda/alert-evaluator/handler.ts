/**
 * Lambda handler: Alert Evaluator
 *
 * Triggered automatically by SQS when messages arrive in the
 * alert-evaluator queue. Each invocation receives a batch of
 * spawn event messages.
 *
 * For each spawned resource:
 * 1. Fetch all enabled alert rules from DynamoDB
 * 2. Check if the resource matches any rule
 * 3. If matched, write a FIRED alert to the alert-rules table
 *
 * Key difference from the manual consumer (process-alerts.ts):
 * - No SQS polling -- Lambda receives the messages directly
 * - No SQS delete -- Lambda auto-deletes on successful return
 * - If the handler throws, Lambda retries (message goes back to queue)
 * - After 3 failures, message goes to DLQ
 *
 * Environment variables (set in OpenTofu):
 * - LOCALSTACK_ENDPOINT: LocalStack URL (for DynamoDB client)
 * - AWS_REGION_CUSTOM: AWS region
 * - ALERT_RULES_TABLE: DynamoDB table name for alert rules
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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
  stat?: string;
  minValue?: number;
  enabled: boolean;
}

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.ALERT_RULES_TABLE || "alert-rules";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Business logic ──────────────────────────────────────────────────

async function fetchAlertRules(): Promise<AlertRule[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );
  return ((result.Items ?? []) as AlertRule[]).filter((r) => r.enabled);
}

function matchesRule(resource: SpawnMessage, rule: AlertRule): boolean {
  if (rule.classPattern) {
    if (!resource.resourceClass.toLowerCase().includes(rule.classPattern.toLowerCase())) {
      return false;
    }
  }
  if (rule.stat && rule.minValue !== undefined) {
    const val = resource.stats[rule.stat];
    if (val === undefined || val < rule.minValue) return false;
  }
  return true;
}

async function recordFiredAlert(resource: SpawnMessage, rule: AlertRule): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: tableName,
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
        if (matchesRule(body, rule)) {
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
