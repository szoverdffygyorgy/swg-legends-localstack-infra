/**
 * Start a Step Functions pipeline execution.
 *
 * Reads the state machine ARN from `tofu output`, starts an execution,
 * and prints the execution ARN for tracking.
 *
 * Usage: npm run pipeline:start
 */

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { execSync } from "node:child_process";
import { LOCALSTACK_ENDPOINT, AWS_REGION } from "../config.js";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function getStateMachineArn(): string {
  if (process.env.STATE_MACHINE_ARN) {
    return process.env.STATE_MACHINE_ARN;
  }

  try {
    return execSync("tofu -chdir=tofu/orchestration output -raw state_machine_arn", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    console.error(
      "Failed to read state machine ARN from tofu output.\n" +
      "Make sure orchestration module infrastructure is provisioned:\n" +
      "  npm run tofu:init:orchestration\n" +
      "  npm run tofu:apply:orchestration\n"
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const arn = getStateMachineArn();
  const sfn = new SFNClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

  console.log("=== Starting Ingestion Pipeline ===\n");
  console.log(`  State machine: ${DIM}${arn}${RESET}`);

  const result = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: arn,
      input: JSON.stringify({}),
    })
  );

  console.log(`\n  ${GREEN}Execution started!${RESET}`);
  console.log(`  Execution ARN: ${DIM}${result.executionArn}${RESET}`);
  console.log(`  Started at:    ${result.startDate?.toISOString()}`);
  console.log(`\n  Track progress with: npm run pipeline:status\n`);
}

main().catch((err) => {
  console.error("Failed to start pipeline:", err);
  process.exit(1);
});
