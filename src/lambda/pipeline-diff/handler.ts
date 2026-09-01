/**
 * Pipeline Lambda: Diff Resources
 *
 * Step 3 of the ingestion state machine.
 * Reads parsed resources from S3, compares against DynamoDB,
 * writes the diff result to S3.
 *
 * Input:  { parsedS3Key: string, xmlS3Key: string }
 * Output: { diffS3Key: string, spawnedCount: number, despawnedCount: number,
 *           unchangedCount: number, dataIssueCount: number, hasChanges: boolean }
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const RESOURCES_TABLE = process.env.RESOURCES_TABLE || "resources";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";

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

interface DiffInput {
  parsedS3Key: string;
  xmlS3Key: string;
}

interface DiffOutput {
  diffS3Key: string;
  xmlS3Key: string;
  spawnedCount: number;
  despawnedCount: number;
  unchangedCount: number;
  dataIssueCount: number;
  hasChanges: boolean;
}

interface ResourceItem {
  resourceId: string;
  planet: string;
  [key: string]: unknown;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: DiffInput): Promise<DiffOutput> {
  console.log(`Step 3: Diffing against DynamoDB`);

  // Read parsed resources from S3
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.parsedS3Key })
  );
  const { resources, dataIssues } = JSON.parse(
    await s3Response.Body!.transformToString("utf-8")
  );

  // Scan current DynamoDB state
  const currentById = new Map<string, ResourceItem[]>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCES_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of (result.Items ?? []) as ResourceItem[]) {
      const existing = currentById.get(item.resourceId);
      if (existing) {
        existing.push(item);
      } else {
        currentById.set(item.resourceId, [item]);
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  const currentIds = new Set(currentById.keys());
  const xmlIds = new Set(resources.map((r: { resourceId: string }) => r.resourceId));

  // Spawned: in XML but not in DynamoDB
  const spawned = resources.filter(
    (r: { resourceId: string }) => !currentIds.has(r.resourceId)
  );

  // Despawned: in DynamoDB but not in XML (all planet rows)
  const despawned: ResourceItem[] = [];
  for (const [id, items] of currentById) {
    if (!xmlIds.has(id)) {
      despawned.push(...items);
    }
  }

  const despawnedUniqueCount = new Set(despawned.map((i) => i.resourceId)).size;
  const unchangedCount = xmlIds.size - spawned.length;

  console.log(
    `Diff: ${spawned.length} spawned, ${despawnedUniqueCount} despawned, ${unchangedCount} unchanged`
  );

  // Write diff result to S3
  const diffS3Key = event.parsedS3Key.replace("parsed.json", "diff.json");
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: diffS3Key,
      Body: JSON.stringify({ spawned, despawned, unchanged: unchangedCount, dataIssues }),
      ContentType: "application/json",
    })
  );

  return {
    diffS3Key,
    xmlS3Key: event.xmlS3Key,
    spawnedCount: spawned.length,
    despawnedCount: despawnedUniqueCount,
    unchangedCount,
    dataIssueCount: dataIssues.length,
    hasChanges: spawned.length > 0 || despawned.length > 0,
  };
}
