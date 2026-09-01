/**
 * Add a new alert rule.
 *
 * Usage:
 *   npm run alerts:add -- --name "Endgame Metal" --class Metal --stat oq:800 --stat sr:400 --planet Tatooine
 *   npm run alerts:add -- --name "Any Copper" --class Copper
 *   npm run alerts:add -- --name "Good Tatooine Iron" --class Iron --stat oq:900 --planet Tatooine --planet Naboo
 *
 * Required args:
 *   --name    Human-readable rule name
 *   --class   Resource class to match (hierarchy-aware: "Metal" matches all metals)
 *
 * Optional args (repeatable):
 *   --stat    Stat threshold as key:value (e.g., --stat oq:800 --stat sr:400)
 *             All thresholds must be met (AND logic).
 *   --planet  Planet filter (e.g., --planet Tatooine --planet Naboo)
 *             Resource must spawn on at least one listed planet (OR logic).
 */

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, ALERT_RULES_TABLE } from "../config.js";
import { ALL_STAT_KEYS } from "../types.js";
import type { StatKey } from "../types.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/**
 * Get a single argument value by name.
 */
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

/**
 * Get all values for a repeatable argument.
 * e.g., --stat oq:800 --stat sr:400 returns ["oq:800", "sr:400"]
 */
function getAllArgs(name: string): string[] {
  const values: string[] = [];
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

async function main(): Promise<void> {
  const name = getArg("name");
  const classPattern = getArg("class");
  const statArgs = getAllArgs("stat");
  const planetArgs = getAllArgs("planet");

  // Validate required args
  if (!name || !classPattern) {
    console.error(`${RED}Missing required arguments.${RESET}\n`);
    console.error("Usage:");
    console.error(
      '  npm run alerts:add -- --name "Endgame Metal" --class Metal --stat oq:800 --stat sr:400 --planet Tatooine'
    );
    console.error(
      '  npm run alerts:add -- --name "Any Copper" --class Copper\n'
    );
    process.exit(1);
  }

  // Parse stat thresholds (key:value format)
  const statThresholds: Record<string, number> = {};
  for (const arg of statArgs) {
    const colonIdx = arg.indexOf(":");
    if (colonIdx === -1) {
      console.error(`${RED}Invalid stat format: "${arg}". Use key:value (e.g., oq:800)${RESET}`);
      process.exit(1);
    }
    const key = arg.slice(0, colonIdx) as StatKey;
    const val = Number(arg.slice(colonIdx + 1));

    if (!ALL_STAT_KEYS.includes(key)) {
      console.error(
        `${RED}Invalid stat: "${key}". Valid stats: ${ALL_STAT_KEYS.join(", ")}${RESET}`
      );
      process.exit(1);
    }
    if (isNaN(val) || val < 0) {
      console.error(`${RED}Invalid threshold for ${key}: "${arg.slice(colonIdx + 1)}"${RESET}`);
      process.exit(1);
    }

    statThresholds[key] = val;
  }

  const ruleId = `r_${Date.now()}`;
  const docClient = createDocClient();

  const item: Record<string, unknown> = {
    pk: "RULE",
    sk: ruleId,
    name,
    classPattern,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  if (Object.keys(statThresholds).length > 0) {
    item.statThresholds = statThresholds;
  }
  if (planetArgs.length > 0) {
    item.planets = planetArgs;
  }

  await docClient.send(
    new PutCommand({
      TableName: ALERT_RULES_TABLE,
      Item: item,
    })
  );

  const statInfo = Object.entries(statThresholds)
    .map(([k, v]) => `${k.toUpperCase()} >= ${v}`)
    .join(", ");

  const planetInfo = planetArgs.length > 0
    ? `\n  Planets: ${planetArgs.join(", ")}`
    : "";

  console.log(`\n${GREEN}Alert rule created:${RESET}\n`);
  console.log(`  ID:      ${ruleId}`);
  console.log(`  Name:    ${YELLOW}${name}${RESET}`);
  console.log(`  Class:   ${classPattern} (hierarchy-aware)`);
  if (statInfo) console.log(`  Stats:   ${statInfo}`);
  if (planetInfo) console.log(planetInfo);
  console.log(`  Enabled: true\n`);
}

main().catch((err) => {
  console.error("Failed to add alert rule:", err);
  process.exit(1);
});
