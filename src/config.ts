/**
 * Shared AWS client configuration for LocalStack.
 *
 * Every script that talks to AWS needs three things:
 * 1. Endpoint URL (localhost:4566 for LocalStack)
 * 2. Region (us-east-1, arbitrary but required)
 * 3. Credentials (dummy "test/test" -- LocalStack ignores them)
 *
 * Instead of repeating this in every file, we define it once here
 * and export factory functions for each AWS client we need.
 *
 * In a real AWS project, you wouldn't hardcode any of this -- the SDK
 * automatically reads from environment variables, ~/.aws/credentials,
 * or IAM roles. The explicit config here is only needed because we're
 * pointing at LocalStack instead of real AWS.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// ─── Shared configuration ────────────────────────────────────────────

export const LOCALSTACK_ENDPOINT = "http://localhost:4566";
export const AWS_REGION = "us-east-1";

const credentials = {
  accessKeyId: "test",
  secretAccessKey: "test",
};

// ─── Client factories ────────────────────────────────────────────────
// Each function creates a new client instance. We use functions (not
// top-level constants) so the clients are only created when needed.

export function createS3Client(): S3Client {
  return new S3Client({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION,
    credentials,
    forcePathStyle: true,
  });
}

export function createDynamoDBClient(): DynamoDBClient {
  return new DynamoDBClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION,
    credentials,
  });
}

/**
 * DynamoDB Document Client -- a higher-level wrapper around DynamoDBClient.
 *
 * The raw DynamoDB API uses a verbose format for data:
 *   { name: { S: "Teiadi" }, oq: { N: "794" } }
 *
 * The Document Client lets you use plain JavaScript objects:
 *   { name: "Teiadi", oq: 794 }
 *
 * It automatically converts between the two formats. Much nicer to
 * work with for application code.
 */
export function createDocClient(): DynamoDBDocumentClient {
  const client = createDynamoDBClient();
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      // Don't convert empty strings to null (DynamoDB doesn't allow
      // empty strings by default, but LocalStack does)
      removeUndefinedValues: true,
    },
  });
}

// ─── Constants ───────────────────────────────────────────────────────

/** S3 bucket name for raw XML export archives */
export const RAW_EXPORTS_BUCKET = "swg-legends-raw-exports";

/** DynamoDB table name for current resource spawns */
export const RESOURCES_TABLE = "resources";

/** DynamoDB table name for historical resource data */
export const RESOURCE_HISTORY_TABLE = "resource-history";

/** SWGAide export URL for SWG Legends (server 138) current resources */
export const SWGAIDE_RESOURCES_URL =
  "https://swgaide.com/pub/exports/currentresources_138.xml.gz";
