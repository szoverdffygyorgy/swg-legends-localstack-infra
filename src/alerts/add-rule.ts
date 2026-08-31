/**
 * Add a new alert rule.
 *
 * Usage:
 *   npm run alerts:add -- --name "Good Copper" --class Copper --stat oq --min 900
 *   npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"
 *
 * Required args:
 *   --name    Human-readable rule name
 *   --class   Resource class substring to match (case-insensitive)
 *
 * Optional args:
 *   --stat    Stat key to check (er, cr, cd, dr, fl, hr, ma, pe, oq, sr, ut)
 *   --min     Minimum stat value (requires --stat)
 */

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, ALERT_RULES_TABLE } from "../config.js";
import { ALL_STAT_KEYS } from "../types.js";
import type { StatKey } from "../types.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

async function main(): Promise<void> {
  const name = getArg("name");
  const classPattern = getArg("class");
  const stat = getArg("stat") as StatKey | undefined;
  const minStr = getArg("min");
  const minValue = minStr ? Number(minStr) : undefined;

  // Validate required args
  if (!name || !classPattern) {
    console.error(`${RED}Missing required arguments.${RESET}\n`);
    console.error("Usage:");
    console.error(
      '  npm run alerts:add -- --name "Good Copper" --class Copper --stat oq --min 900'
    );
    console.error(
      '  npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"\n'
    );
    process.exit(1);
  }

  // Validate stat key
  if (stat && !ALL_STAT_KEYS.includes(stat)) {
    console.error(
      `${RED}Invalid stat: "${stat}". Valid stats: ${ALL_STAT_KEYS.join(", ")}${RESET}`
    );
    process.exit(1);
  }

  // Validate min requires stat
  if (minValue !== undefined && !stat) {
    console.error(`${RED}--min requires --stat${RESET}`);
    process.exit(1);
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

  if (stat) item.stat = stat;
  if (minValue !== undefined) item.minValue = minValue;

  await docClient.send(
    new PutCommand({
      TableName: ALERT_RULES_TABLE,
      Item: item,
    })
  );

  const statInfo =
    stat && minValue !== undefined
      ? ` | ${stat.toUpperCase()} >= ${minValue}`
      : "";

  console.log(`\n${GREEN}Alert rule created:${RESET}\n`);
  console.log(`  ID:      ${ruleId}`);
  console.log(`  Name:    ${YELLOW}${name}${RESET}`);
  console.log(`  Match:   class contains "${classPattern}"${statInfo}`);
  console.log(`  Enabled: true\n`);
}

main().catch((err) => {
  console.error("Failed to add alert rule:", err);
  process.exit(1);
});
