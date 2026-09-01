/**
 * Build and deploy the React frontend to S3 static website hosting.
 *
 * Steps:
 * 1. Build the React app (npm run build in frontend/)
 * 2. Upload all files from frontend/dist/ to the S3 bucket
 * 3. Print the website URL
 *
 * The build injects the API base URL so the frontend knows where
 * to send API requests when hosted on S3 (no Vite proxy available).
 *
 * Run with: npm run frontend:deploy
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const LOCALSTACK_ENDPOINT = "http://localhost:4566";
const AWS_REGION = "us-east-1";
const BUCKET = "swg-legends-frontend";
const FRONTEND_DIR = "frontend";
const DIST_DIR = `${FRONTEND_DIR}/dist`;

const s3 = new S3Client({
  endpoint: LOCALSTACK_ENDPOINT,
  region: AWS_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

// Content-type mapping
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Recursively list all files in a directory.
 */
function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFiles(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

async function main(): Promise<void> {
  console.log("=== Deploy Frontend to S3 ===\n");

  // Step 1: Get API base URL for the production build
  let apiBaseUrl: string;
  try {
    apiBaseUrl = execSync(
      "tofu -chdir=tofu/phase4 output -raw api_base_url",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch {
    console.error(
      "Failed to read API base URL from tofu output.\n" +
      "Make sure Phase 4 is provisioned: npm run tofu:apply:phase4\n"
    );
    process.exit(1);
  }

  console.log(`  API base URL: ${apiBaseUrl}`);

  // Step 2: Build the frontend with the API URL baked in
  console.log("  Building frontend...");
  execSync(`npm run build`, {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiBaseUrl,
    },
  });

  // Step 3: Upload all files to S3
  console.log("\n  Uploading to S3...");
  const files = listFiles(DIST_DIR);

  for (const file of files) {
    const filePath = join(DIST_DIR, file);
    const content = readFileSync(filePath);
    const contentType = getContentType(file);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: file,
        Body: content,
        ContentType: contentType,
      })
    );

    const sizeKB = Math.round(content.length / 1024);
    console.log(`    ${file} (${sizeKB} KB, ${contentType})`);
  }

  console.log(`\n  Uploaded ${files.length} files to s3://${BUCKET}/`);

  // Step 4: Upload resource class tree JSON (static reference data)
  // This is served alongside the frontend for the class hierarchy browser.
  const classTreePath = "src/data/resource-class-tree.json";
  const classTreeContent = readFileSync(classTreePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: "resource-class-tree.json",
      Body: classTreeContent,
      ContentType: "application/json",
    })
  );
  const classTreeSize = Math.round(classTreeContent.length / 1024);
  console.log(`  resource-class-tree.json (${classTreeSize} KB, application/json)`);

  // Step 5: Print access URL
  const url = `${LOCALSTACK_ENDPOINT}/${BUCKET}/index.html`;
  console.log(`\n  Website URL: ${url}`);
  console.log(`\n  Note: For local development, use 'npm run frontend:dev' instead.`);
  console.log(`  The S3-hosted version calls the API directly (no Vite proxy).\n`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
