/**
 * List all alert rules.
 *
 * Usage:
 *   npm run alerts:list
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, ALERT_RULES_TABLE } from "../config.js";

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface AlertRule {
  pk: string;
  sk: string;
  name: string;
  classPattern: string;
  stat?: string;
  minValue?: number;
  enabled: boolean;
  createdAt?: string;
}

async function main(): Promise<void> {
  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERT_RULES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );

  const rules = (result.Items ?? []) as AlertRule[];

  console.log("\n=== Alert Rules ===\n");

  if (rules.length === 0) {
    console.log(
      `  ${DIM}No alert rules defined. Add one with:${RESET}`
    );
    console.log(
      `  npm run alerts:add -- --name "Good Copper" --class Copper --stat oq --min 900\n`
    );
    return;
  }

  // Column widths
  const idWidth = Math.max(6, ...rules.map((r) => r.sk.length));
  const nameWidth = Math.max(8, ...rules.map((r) => r.name.length));
  const classWidth = Math.max(9, ...rules.map((r) => r.classPattern.length));

  // Header
  const header = [
    "ID".padEnd(idWidth),
    "NAME".padEnd(nameWidth),
    "CLASS".padEnd(classWidth),
    "STAT",
    "  MIN",
    "  ENABLED",
  ].join("  ");

  console.log(`  ${DIM}${header}${RESET}`);
  console.log(`  ${DIM}${"-".repeat(header.length)}${RESET}`);

  for (const rule of rules) {
    const enabledStr = rule.enabled
      ? `${GREEN}yes${RESET}`
      : `${RED}no${RESET}`;
    const statStr = rule.stat ? rule.stat.toUpperCase().padEnd(4) : `${DIM}  - ${RESET}`;
    const minStr =
      rule.minValue !== undefined
        ? String(rule.minValue).padStart(5)
        : `${DIM}    -${RESET}`;

    const row = [
      `${DIM}${rule.sk.padEnd(idWidth)}${RESET}`,
      `${YELLOW}${rule.name.padEnd(nameWidth)}${RESET}`,
      rule.classPattern.padEnd(classWidth),
      statStr,
      minStr,
      `  ${enabledStr}`,
    ].join("  ");

    console.log(`  ${row}`);
  }

  console.log(`\n  ${rules.length} rule(s)\n`);
}

main().catch((err) => {
  console.error("Failed to list alert rules:", err);
  process.exit(1);
});
