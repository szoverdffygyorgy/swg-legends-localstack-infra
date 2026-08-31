/**
 * Verification script: proves TypeScript + AWS SDK v3 can talk to LocalStack.
 *
 * What this does:
 * 1. Creates an S3 bucket
 * 2. Lists all buckets (confirms it exists)
 * 3. Deletes the bucket
 * 4. Lists again (confirms it's gone)
 *
 * Run with: npm run verify
 * (which runs: tsx src/verify-localstack.ts)
 */

import {
  S3Client,
  CreateBucketCommand,
  ListBucketsCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";

// ─── Client configuration ────────────────────────────────────────────
// This is the pattern you'll use for every AWS service:
// 1. Create a client with endpoint + region + credentials
// 2. Send commands through that client
//
// The only difference from real AWS: we set `endpoint` and `forcePathStyle`.
// In production, you'd remove those two lines and let the SDK use
// real AWS endpoints + IAM credentials.

const s3 = new S3Client({
  endpoint: "http://localhost:4566",
  region: "us-east-1",
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
  forcePathStyle: true, // Required for LocalStack (same reason as in OpenTofu)
});

const BUCKET_NAME = "sdk-verification-test";

async function main() {
  console.log("=== LocalStack + AWS SDK v3 Verification ===\n");

  // 1. Create bucket
  console.log(`1. Creating bucket: ${BUCKET_NAME}`);
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
  console.log("   Done.\n");

  // 2. List buckets
  console.log("2. Listing all buckets:");
  const listResult = await s3.send(new ListBucketsCommand({}));
  for (const bucket of listResult.Buckets ?? []) {
    console.log(`   - ${bucket.Name} (created: ${bucket.CreationDate})`);
  }
  console.log();

  // 3. Delete bucket
  console.log(`3. Deleting bucket: ${BUCKET_NAME}`);
  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET_NAME }));
  console.log("   Done.\n");

  // 4. Confirm deletion
  console.log("4. Listing buckets after deletion:");
  const afterDelete = await s3.send(new ListBucketsCommand({}));
  if ((afterDelete.Buckets ?? []).length === 0) {
    console.log("   (empty -- bucket was deleted successfully)\n");
  } else {
    for (const bucket of afterDelete.Buckets ?? []) {
      console.log(`   - ${bucket.Name}`);
    }
  }

  console.log("=== Verification complete. Everything works. ===");
}

main().catch((err) => {
  console.error("Verification FAILED:", err);
  process.exit(1);
});
