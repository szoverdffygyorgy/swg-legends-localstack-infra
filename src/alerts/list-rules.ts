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
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

interface AlertRule {
  pk: string;
  sk: string;
  name: string;
  classPattern: string;
  statThresholds?: Record<string, number>;
  planets?: string[];
  // Legacy format
  stat?: string;
  minValue?: number;
  enabled: boolean;
  createdAt?: string;
}

/**
 * Normalize stat thresholds from either new or legacy format.
 */
function getThresholds(rule: AlertRule): Record<string, number> {
  if (rule.statThresholds) return rule.statThresholds;
  if (rule.stat && rule.minValue !== undefined) return { [rule.stat]: rule.minValue };
  return {};
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
      `  npm run alerts:add -- --name "Good Copper" --class Copper --stat oq:800\n`
    );
    return;
  }

  for (const rule of rules) {
    const enabledStr = rule.enabled
      ? `${GREEN}enabled${RESET}`
      : `${RED}disabled${RESET}`;

    const thresholds = getThresholds(rule);
    const statStr = Object.keys(thresholds).length > 0
      ? Object.entries(thresholds)
          .map(([k, v]) => `${CYAN}${k.toUpperCase()}>=${v}${RESET}`)
          .join(", ")
      : `${DIM}none${RESET}`;

    const planets = rule.planets ?? [];
    const planetStr = planets.length > 0
      ? planets.join(", ")
      : `${DIM}all${RESET}`;

    console.log(`  ${YELLOW}${rule.name}${RESET}  ${DIM}(${rule.sk})${RESET}  ${enabledStr}`);
    console.log(`    Class:   ${rule.classPattern} (hierarchy-aware)`);
    console.log(`    Stats:   ${statStr}`);
    console.log(`    Planets: ${planetStr}`);
    console.log();
  }

  console.log(`  ${rules.length} rule(s)\n`);
}

main().catch((err) => {
  console.error("Failed to list alert rules:", err);
  process.exit(1);
});
