/**
 * Lambda handler: History Recorder
 *
 * Triggered automatically by SQS when messages arrive in the
 * history-recorder queue. Each invocation receives a batch of
 * despawn event messages.
 *
 * For each despawned resource:
 * 1. Write to the resource-history DynamoDB table
 *
 * This preserves a record of every resource that has ever existed
 * on the server, enabling queries like "show me all past spawns
 * of Desh Copper" or "what resources despawned this week?"
 *
 * Environment variables (set in OpenTofu):
 * - LOCALSTACK_ENDPOINT: LocalStack URL (for DynamoDB client)
 * - AWS_REGION_CUSTOM: AWS region
 * - RESOURCE_HISTORY_TABLE: DynamoDB table name for history
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

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

// ─── Config ──────────────────────────────────────────────────────────

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const tableName = process.env.RESOURCE_HISTORY_TABLE || "resource-history";

const ddbClient = new DynamoDBClient({ endpoint, region });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Lambda handler ──────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<void> {
  const now = new Date().toISOString();
  console.log(`History recorder invoked with ${event.Records.length} record(s)`);

  let recorded = 0;

  for (const record of event.Records) {
    try {
      const body: DespawnMessage = JSON.parse(record.body);
      console.log(`Recording despawn: ${body.resourceName} (${body.resourceClass})`);

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            resourceId: body.resourceId,
            despawnedAt: now,
            resourceName: body.resourceName,
            resourceClass: body.resourceClass,
            resourceClassId: body.resourceClassId,
            planets: body.planets.join(", "),
            stats: body.stats,
            availableTimestamp: body.availableTimestamp,
            availableBy: body.availableBy,
          },
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
