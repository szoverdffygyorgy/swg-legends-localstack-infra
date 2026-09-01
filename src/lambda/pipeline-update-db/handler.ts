/**
 * Pipeline Lambda: Update DynamoDB
 *
 * Step 4 of the ingestion state machine.
 * Reads the diff from S3, adds spawned resources and removes despawned
 * resources from the resources DynamoDB table.
 *
 * Input:  { diffS3Key: string, xmlS3Key: string, spawnedCount: number, ... }
 * Output: { ...input, itemsAdded: number, itemsRemoved: number }
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const RESOURCES_TABLE = process.env.RESOURCES_TABLE || "resources";
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

// ─── Denormalize (same logic as load-resources.ts) ───────────────────

function denormalize(resource: SWGResource): Record<string, unknown>[] {
  const base = {
    resourceId: resource.resourceId,
    resourceName: resource.resourceName,
    resourceClass: resource.resourceClass,
    resourceClassId: resource.resourceClassId,
    allPlanets: resource.planets.join(", "),
    availableTimestamp: resource.availableTimestamp,
    availableBy: resource.availableBy,
  };

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

  // Read diff from S3
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.diffS3Key })
  );
  const diff = JSON.parse(await s3Response.Body!.transformToString("utf-8"));

  let itemsAdded = 0;
  let itemsRemoved = 0;

  // Add spawned resources
  if (diff.spawned.length > 0) {
    const items = diff.spawned.flatMap(denormalize);
    console.log(`Adding ${diff.spawned.length} resources (${items.length} items)`);

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

  return { ...event, itemsAdded, itemsRemoved };
}
