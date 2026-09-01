/**
 * Check the status of Step Functions pipeline executions.
 *
 * Lists recent executions and shows the current status of each.
 * For running/failed executions, shows the history of states visited.
 *
 * Usage: npm run pipeline:status
 */

import {
  SFNClient,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
} from "@aws-sdk/client-sfn";
import { execSync } from "node:child_process";
import { LOCALSTACK_ENDPOINT, AWS_REGION } from "../config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function getStateMachineArn(): string {
  if (process.env.STATE_MACHINE_ARN) {
    return process.env.STATE_MACHINE_ARN;
  }

  try {
    return execSync("tofu -chdir=tofu/phase5 output -raw state_machine_arn", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    console.error(
      "Failed to read state machine ARN from tofu output.\n" +
      "Make sure Phase 5 infrastructure is provisioned.\n"
    );
    process.exit(1);
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "SUCCEEDED": return GREEN;
    case "FAILED": case "TIMED_OUT": case "ABORTED": return RED;
    case "RUNNING": return YELLOW;
    default: return DIM;
  }
}

async function main(): Promise<void> {
  const arn = getStateMachineArn();
  const sfn = new SFNClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

  console.log("=== Ingestion Pipeline Executions ===\n");

  const executions = await sfn.send(
    new ListExecutionsCommand({ stateMachineArn: arn, maxResults: 5 })
  );

  if (!executions.executions || executions.executions.length === 0) {
    console.log("  No executions found. Start one with: npm run pipeline:start\n");
    return;
  }

  for (const exec of executions.executions) {
    const status = exec.status || "UNKNOWN";
    const color = statusColor(status);
    const started = exec.startDate?.toISOString() ?? "?";
    const stopped = exec.stopDate?.toISOString();
    const duration = exec.startDate && exec.stopDate
      ? `${((exec.stopDate.getTime() - exec.startDate.getTime()) / 1000).toFixed(1)}s`
      : "running...";

    console.log(`  ${color}${status.padEnd(10)}${RESET}  ${started}  ${DIM}(${duration})${RESET}`);
    console.log(`             ${DIM}${exec.executionArn}${RESET}`);

    // For the most recent execution, show step details
    if (exec === executions.executions[0] && exec.executionArn) {
      try {
        const detail = await sfn.send(
          new DescribeExecutionCommand({ executionArn: exec.executionArn })
        );

        // Show execution output or error
        if (detail.status === "SUCCEEDED" && detail.output) {
          try {
            const output = JSON.parse(detail.output);
            console.log(`\n  ${GREEN}Output:${RESET}`);
            if (output.archiveS3Key) {
              console.log(`    Archive: s3://swg-legends-raw-exports/${output.archiveS3Key}`);
            }
            if (output.tempFilesCleaned !== undefined) {
              console.log(`    Temp files cleaned: ${output.tempFilesCleaned}`);
            }
          } catch {
            console.log(`\n  Output: ${detail.output}`);
          }
        } else if (detail.status === "FAILED") {
          console.log(`\n  ${RED}Error: ${detail.error}${RESET}`);
          if (detail.cause) {
            console.log(`  ${RED}Cause: ${detail.cause}${RESET}`);
          }
        }

        // Show execution history (states visited)
        const history = await sfn.send(
          new GetExecutionHistoryCommand({
            executionArn: exec.executionArn,
            maxResults: 50,
          })
        );

        const stateEvents = (history.events ?? []).filter(
          (e) =>
            e.type === "TaskStateEntered" ||
            e.type === "TaskSucceeded" ||
            e.type === "TaskFailed" ||
            e.type === "ChoiceStateEntered" ||
            e.type === "ParallelStateEntered" ||
            e.type === "ParallelStateExited" ||
            e.type === "SucceedStateEntered" ||
            e.type === "FailStateEntered"
        );

        if (stateEvents.length > 0) {
          console.log(`\n  Steps:`);
          for (const evt of stateEvents) {
            const name =
              (evt as Record<string, unknown>).stateEnteredEventDetails
                ? ((evt as Record<string, Record<string, string>>).stateEnteredEventDetails?.name ?? "")
                : ((evt as Record<string, Record<string, string>>).stateExitedEventDetails?.name ?? "");
            const icon =
              evt.type?.includes("Succeeded") || evt.type?.includes("Exited") ? `${GREEN}done${RESET}` :
              evt.type?.includes("Failed") ? `${RED}fail${RESET}` :
              evt.type?.includes("Entered") ? `${YELLOW} >> ${RESET}` : "  ";
            if (name) {
              console.log(`    ${icon}  ${name}`);
            }
          }
        }
      } catch {
        // History might not be available for all execution states
      }
    }

    console.log();
  }
}

main().catch((err) => {
  console.error("Failed to check pipeline status:", err);
  process.exit(1);
});
