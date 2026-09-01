/**
 * Build and deploy Lambda functions to LocalStack.
 *
 * Steps for each Lambda:
 * 1. esbuild: TypeScript -> single bundled JavaScript file
 *    (tree-shakes unused code, inlines dependencies)
 * 2. zip: create a deployment package
 * 3. deploy: upload to LocalStack via UpdateFunctionCode API
 *
 * Why esbuild?
 * - Fast (~50ms to bundle)
 * - Tree-shakes: only includes code your handler actually uses
 * - Output is a single file (~500KB vs ~10MB for node_modules)
 * - Lambda cold starts are faster with smaller bundles
 *
 * Run with: npm run lambda:build
 */

import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { LambdaClient, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";

// We need the Lambda client SDK for deployment
// It's already available via @aws-sdk transitive deps

const LOCALSTACK_ENDPOINT = "http://localhost:4566";
const AWS_REGION = "us-east-1";

const LAMBDAS = [
  // Phase 3: SQS-triggered Lambdas
  {
    name: "alert-evaluator",
    entry: "src/lambda/alert-evaluator/handler.ts",
  },
  {
    name: "history-recorder",
    entry: "src/lambda/history-recorder/handler.ts",
  },
  // Phase 4: API Gateway Lambdas
  {
    name: "api-get-resources",
    entry: "src/lambda/api-get-resources/handler.ts",
  },
  {
    name: "api-get-events",
    entry: "src/lambda/api-get-events/handler.ts",
  },
  {
    name: "api-alerts",
    entry: "src/lambda/api-alerts/handler.ts",
  },
  // Phase 5: Pipeline Step Functions Lambdas
  {
    name: "pipeline-download",
    entry: "src/lambda/pipeline-download/handler.ts",
  },
  {
    name: "pipeline-parse",
    entry: "src/lambda/pipeline-parse/handler.ts",
  },
  {
    name: "pipeline-diff",
    entry: "src/lambda/pipeline-diff/handler.ts",
  },
  {
    name: "pipeline-update-db",
    entry: "src/lambda/pipeline-update-db/handler.ts",
  },
  {
    name: "pipeline-log-events",
    entry: "src/lambda/pipeline-log-events/handler.ts",
  },
  {
    name: "pipeline-publish-sns",
    entry: "src/lambda/pipeline-publish-sns/handler.ts",
  },
  {
    name: "pipeline-archive",
    entry: "src/lambda/pipeline-archive/handler.ts",
  },
];

const BUILD_DIR = "dist/lambda";

async function buildAndDeploy(): Promise<void> {
  console.log("=== Build and Deploy Lambda Functions ===\n");

  // Clean build directory
  if (existsSync(BUILD_DIR)) {
    rmSync(BUILD_DIR, { recursive: true });
  }
  mkdirSync(BUILD_DIR, { recursive: true });

  const lambdaClient = new LambdaClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION,
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });

  for (const lambda of LAMBDAS) {
    console.log(`[${lambda.name}]`);

    // Step 1: Bundle with esbuild
    const outfile = `${BUILD_DIR}/${lambda.name}/index.js`;
    console.log(`  Bundling: ${lambda.entry} -> ${outfile}`);

    await esbuild.build({
      entryPoints: [lambda.entry],
      bundle: true,
      platform: "node",
      target: "node22",
      outfile,
      format: "cjs", // Lambda expects CommonJS by default
      minify: false, // Keep readable for debugging
      sourcemap: false,
      // Mark aws-sdk as external if using the built-in Lambda runtime SDK
      // But since we bundle everything, we don't need this
    });

    const jsSize = readFileSync(outfile).length;
    console.log(`  Bundle size: ${Math.round(jsSize / 1024)} KB`);

    // Step 2: Zip
    const zipPath = `${BUILD_DIR}/${lambda.name}.zip`;
    const outDir = `${BUILD_DIR}/${lambda.name}`;
    execSync(`cd "${outDir}" && zip -j "${process.cwd()}/${zipPath}" index.js`, {
      stdio: "pipe",
    });

    const zipSize = readFileSync(zipPath).length;
    console.log(`  Zip size: ${Math.round(zipSize / 1024)} KB`);

    // Step 3: Deploy to LocalStack
    console.log(`  Deploying to LocalStack...`);
    const zipBuffer = readFileSync(zipPath);

    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambda.name,
        ZipFile: zipBuffer,
      })
    );

    console.log(`  Deployed: ${lambda.name}\n`);
  }

  console.log("=== All Lambda functions built and deployed ===");
}

buildAndDeploy().catch((err) => {
  console.error("Build/deploy failed:", err);
  process.exit(1);
});
