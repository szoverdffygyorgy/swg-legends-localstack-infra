/**
 * View fired alert history.
 *
 * Usage:
 *   npm run alerts:history                # all fired alerts
 *   npm run alerts:history -- --last 24   # last 24 hours only
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, ALERT_RULES_TABLE } from "../config.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

interface FiredAlert {
  pk: string;
  sk: string;
  ruleId: string;
  ruleName: string;
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  planets: string;
  stats: Record<string, number>;
  matchedAt: string;
}

async function main(): Promise<void> {
  const lastHoursStr = getArg("last");
  const lastHours = lastHoursStr ? Number(lastHoursStr) : undefined;

  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERT_RULES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "FIRED" },
      ScanIndexForward: false, // newest first
    })
  );

  let alerts = (result.Items ?? []) as FiredAlert[];

  // Filter by time window if --last is specified
  if (lastHours !== undefined) {
    const cutoff = new Date(Date.now() - lastHours * 60 * 60 * 1000).toISOString();
    alerts = alerts.filter((a) => a.matchedAt >= cutoff);
  }

  console.log("\n=== Fired Alert History ===\n");

  if (lastHours !== undefined) {
    console.log(`  ${DIM}Showing alerts from the last ${lastHours} hours${RESET}\n`);
  }

  if (alerts.length === 0) {
    console.log(`  ${DIM}No alerts have been fired.${RESET}\n`);
    return;
  }

  // Column widths
  const timeWidth = 19; // YYYY-MM-DD HH:MM:SS
  const ruleWidth = Math.max(8, ...alerts.map((a) => a.ruleName.length));
  const nameWidth = Math.max(10, ...alerts.map((a) => a.resourceName.length));
  const classWidth = Math.max(10, ...alerts.map((a) => a.resourceClass.length));

  // Header
  const header = [
    "MATCHED AT".padEnd(timeWidth),
    "RULE".padEnd(ruleWidth),
    "RESOURCE".padEnd(nameWidth),
    "CLASS".padEnd(classWidth),
    "PLANETS",
  ].join("  ");

  console.log(`  ${DIM}${header}${RESET}`);
  console.log(`  ${DIM}${"-".repeat(header.length + 20)}${RESET}`);

  for (const alert of alerts) {
    const time = alert.matchedAt.replace("T", " ").slice(0, 19);
    const statsStr = Object.entries(alert.stats)
      .map(([k, v]) => `${k.toUpperCase()}:${v}`)
      .join(" ");

    const row = [
      `${DIM}${time}${RESET}`,
      `${YELLOW}${alert.ruleName.padEnd(ruleWidth)}${RESET}`,
      `${GREEN}${alert.resourceName.padEnd(nameWidth)}${RESET}`,
      `${DIM}${alert.resourceClass.padEnd(classWidth)}${RESET}`,
      `${DIM}${alert.planets}${RESET}`,
    ].join("  ");

    console.log(`  ${BOLD}${RED}!${RESET} ${row}`);
    console.log(`    ${DIM}${statsStr}${RESET}`);
  }

  console.log(`\n  ${alerts.length} alert(s) fired\n`);
}

main().catch((err) => {
  console.error("Failed to query alert history:", err);
  process.exit(1);
});
