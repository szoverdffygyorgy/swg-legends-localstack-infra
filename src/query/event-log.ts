/**
 * Query the event log: show recent spawn/despawn events.
 *
 * Usage:
 *   npm run events                          # today's events
 *   npm run events -- --date 2026-08-31     # events for a specific date
 *
 * Events are stored in the event-log DynamoDB table, partitioned by date.
 * Each query returns all events for a single day, ordered chronologically.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient, EVENT_LOG_TABLE } from "../config.js";
import type { EventLogItem } from "../types.js";

// ANSI color codes for terminal output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

async function queryEvents(date: string): Promise<EventLogItem[]> {
  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: EVENT_LOG_TABLE,
      KeyConditionExpression: "#d = :date",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":date": date },
      ScanIndexForward: false, // newest first
    })
  );

  return (result.Items ?? []) as EventLogItem[];
}

function printEvents(events: EventLogItem[], date: string): void {
  console.log(`\n  Events for ${YELLOW}${date}${RESET}:\n`);

  if (events.length === 0) {
    console.log(`  ${DIM}No events recorded for this date.${RESET}\n`);
    return;
  }

  // Column widths
  const timeWidth = 8; // HH:MM:SS
  const typeWidth = 10;
  const nameWidth = Math.max(12, ...events.map((e) => e.resourceName.length));
  const classWidth = Math.max(14, ...events.map((e) => e.resourceClass.length));
  const planetWidth = Math.max(10, ...events.map((e) => e.planets.length));

  // Header
  const header = [
    "TIME".padEnd(timeWidth),
    "EVENT".padEnd(typeWidth),
    "NAME".padEnd(nameWidth),
    "CLASS".padEnd(classWidth),
    "PLANETS".padEnd(planetWidth),
    "STATS",
  ].join("  ");

  console.log(`  ${DIM}${header}${RESET}`);
  console.log(`  ${DIM}${"-".repeat(header.length)}${RESET}`);

  for (const event of events) {
    const time = event.detectedAt.slice(11, 19); // HH:MM:SS
    const color = event.eventType === "SPAWNED" ? GREEN : RED;
    const typeStr = event.eventType === "SPAWNED" ? "+ SPAWNED" : "- DESPAWN";

    const row = [
      `${DIM}${time}${RESET}`,
      `${color}${typeStr.padEnd(typeWidth)}${RESET}`,
      event.resourceName.padEnd(nameWidth),
      `${DIM}${event.resourceClass.padEnd(classWidth)}${RESET}`,
      `${DIM}${event.planets.padEnd(planetWidth)}${RESET}`,
      `${DIM}${event.statSummary}${RESET}`,
    ].join("  ");

    console.log(`  ${row}`);
  }

  const spawned = events.filter((e) => e.eventType === "SPAWNED").length;
  const despawned = events.filter((e) => e.eventType === "DESPAWNED").length;

  console.log();
  console.log(
    `  ${GREEN}${spawned} spawned${RESET}, ${RED}${despawned} despawned${RESET} (${events.length} total events)\n`
  );
}

async function main(): Promise<void> {
  const date = getArg("date") || new Date().toISOString().slice(0, 10);

  console.log("=== SWG Legends Event Log ===");

  const events = await queryEvents(date);
  printEvents(events, date);
}

main().catch((err) => {
  console.error("Event log query failed:", err);
  process.exit(1);
});
