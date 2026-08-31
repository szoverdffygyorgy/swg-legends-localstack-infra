/**
 * History recorder: processes despawn events from SQS.
 *
 * This consumer reads messages from the history-recorder SQS queue
 * (fed by the resource-despawned SNS topic) and writes each despawned
 * resource to the resource-history DynamoDB table.
 *
 * The resource-history table preserves a record of every resource that
 * has ever existed on the server. Key schema:
 *   - Partition key: resourceId
 *   - Sort key: despawnedAt (ISO timestamp)
 *
 * This enables queries like:
 *   "Show me all past spawns of Desh Copper"
 *   "What resources despawned yesterday?"
 *
 * SQS consumer pattern:
 * 1. ReceiveMessage (long-poll, wait up to N seconds for messages)
 * 2. Process each message
 * 3. DeleteMessage (acknowledge successful processing)
 * 4. Repeat until queue is empty
 *
 * If processing fails (crash, error), the message becomes visible
 * again after the visibility timeout (30s). After 3 failures, SQS
 * moves it to the dead letter queue.
 *
 * Run with: npm run process:history
 */

import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  createSQSClient,
  createDocClient,
  HISTORY_RECORDER_QUEUE_URL,
  RESOURCE_HISTORY_TABLE,
} from "../config.js";

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

async function main(): Promise<void> {
  const sqs = createSQSClient();
  const docClient = createDocClient();
  const now = new Date().toISOString();

  console.log("=== History Recorder: Processing Despawn Events ===\n");
  console.log(`  Queue: ${HISTORY_RECORDER_QUEUE_URL}\n`);

  let totalProcessed = 0;
  let emptyPolls = 0;

  // Keep polling until we get two empty responses in a row
  // (queue is drained)
  while (emptyPolls < 2) {
    const response = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: HISTORY_RECORDER_QUEUE_URL,
        MaxNumberOfMessages: 10, // Max per request
        WaitTimeSeconds: 3, // Short poll for drain mode
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
        const body: DespawnMessage = JSON.parse(message.Body ?? "{}");

        // Write to resource-history table
        await docClient.send(
          new PutCommand({
            TableName: RESOURCE_HISTORY_TABLE,
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

        // Delete message from queue (acknowledge processing)
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: HISTORY_RECORDER_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          })
        );

        totalProcessed++;
        console.log(
          `  Archived: ${body.resourceName} (${body.resourceClass}) [${body.planets.join(", ")}]`
        );
      } catch (err) {
        console.error(
          `  Failed to process message ${message.MessageId}:`,
          err
        );
        // Don't delete the message -- it will become visible again
        // and retry (or eventually go to DLQ after 3 failures)
      }
    }
  }

  console.log(`\nDone: ${totalProcessed} despawned resources archived to resource-history table`);
}

main().catch((err) => {
  console.error("History recorder failed:", err);
  process.exit(1);
});
