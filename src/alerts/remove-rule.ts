/**
 * Remove an alert rule by ID.
 *
 * Usage:
 *   npm run alerts:remove -- --id r_1725105600000
 *
 * Get the rule ID from `npm run alerts:list`.
 */

import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, ALERT_RULES_TABLE } from "../config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

async function main(): Promise<void> {
  const ruleId = getArg("id");

  if (!ruleId) {
    console.error(`${RED}Missing required argument: --id${RESET}\n`);
    console.error("Usage:");
    console.error("  npm run alerts:remove -- --id r_1725105600000\n");
    console.error("Get rule IDs from: npm run alerts:list");
    process.exit(1);
  }

  const docClient = createDocClient();

  // Check if the rule exists first (for a better error message)
  const existing = await docClient.send(
    new GetCommand({
      TableName: ALERT_RULES_TABLE,
      Key: { pk: "RULE", sk: ruleId },
    })
  );

  if (!existing.Item) {
    console.error(`\n${RED}Rule not found: ${ruleId}${RESET}`);
    console.error(`Run ${YELLOW}npm run alerts:list${RESET} to see available rules.\n`);
    process.exit(1);
  }

  const ruleName = (existing.Item as Record<string, unknown>).name as string;

  await docClient.send(
    new DeleteCommand({
      TableName: ALERT_RULES_TABLE,
      Key: { pk: "RULE", sk: ruleId },
    })
  );

  console.log(
    `\n${GREEN}Removed rule:${RESET} ${YELLOW}${ruleName}${RESET} (${ruleId})\n`
  );
}

main().catch((err) => {
  console.error("Failed to remove alert rule:", err);
  process.exit(1);
});
