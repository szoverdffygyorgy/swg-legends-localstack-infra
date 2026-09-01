/**
 * Pipeline Lambda: Publish SNS Events
 *
 * Step 5b of the ingestion state machine (runs in parallel with LogEvents).
 * Reads the diff from S3 and publishes spawn/despawn messages to SNS
 * topics, which fan out to SQS queues for Lambda processing.
 *
 * Input:  { diffS3Key: string, ... }
 * Output: { eventsPublished: number }
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = "000000000000";

const SPAWNED_TOPIC_ARN = `arn:aws:sns:${region}:${ACCOUNT_ID}:resource-spawned`;
const DESPAWNED_TOPIC_ARN = `arn:aws:sns:${region}:${ACCOUNT_ID}:resource-despawned`;

const ALL_STAT_KEYS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const sns = new SNSClient({
  endpoint,
  region,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

// ─── Types ───────────────────────────────────────────────────────────

interface PublishInput {
  diffS3Key: string;
  [key: string]: unknown;
}

interface PublishOutput {
  eventsPublished: number;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: PublishInput): Promise<PublishOutput> {
  console.log("Step 5b: Publishing events to SNS");

  // Read diff from S3
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.diffS3Key })
  );
  const diff = JSON.parse(await s3Response.Body!.transformToString("utf-8"));

  let published = 0;

  // Publish spawn events
  for (const resource of diff.spawned) {
    const message = JSON.stringify({
      eventType: "SPAWNED",
      resourceId: resource.resourceId,
      resourceName: resource.resourceName,
      resourceClass: resource.resourceClass,
      resourceClassId: resource.resourceClassId,
      planets: resource.planets,
      stats: resource.stats,
      availableTimestamp: resource.availableTimestamp,
      availableBy: resource.availableBy,
    });

    await sns.send(
      new PublishCommand({ TopicArn: SPAWNED_TOPIC_ARN, Message: message })
    );
    published++;
  }

  // Publish despawn events (deduplicated)
  const seen = new Set<string>();
  for (const item of diff.despawned) {
    if (seen.has(item.resourceId)) continue;
    seen.add(item.resourceId);

    const stats: Record<string, number> = {};
    for (const key of ALL_STAT_KEYS) {
      if (item[key] !== undefined) {
        stats[key] = item[key] as number;
      }
    }

    const message = JSON.stringify({
      eventType: "DESPAWNED",
      resourceId: item.resourceId,
      resourceName: item.resourceName,
      resourceClass: item.resourceClass,
      resourceClassId: item.resourceClassId,
      planets: item.allPlanets.split(", "),
      stats,
      availableTimestamp: item.availableTimestamp,
      availableBy: item.availableBy,
    });

    await sns.send(
      new PublishCommand({ TopicArn: DESPAWNED_TOPIC_ARN, Message: message })
    );
    published++;
  }

  console.log(`Published ${published} events to SNS`);
  return { eventsPublished: published };
}
