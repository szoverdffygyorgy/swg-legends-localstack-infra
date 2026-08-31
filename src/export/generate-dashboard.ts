/**
 * Generates a self-contained HTML dashboard from DynamoDB data.
 *
 * The dashboard is styled to look like the SWG Bazaar Terminal -- dark
 * background, monospace green text, chunky terminal UI elements.
 *
 * Data sources:
 * - resources table: current resource spawns
 * - event-log table: recent spawn/despawn events
 * - alert-rules table: alert rules + fired alert history
 *
 * Run with: npm run dashboard
 */

import { ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  createDocClient,
  RESOURCES_TABLE,
  EVENT_LOG_TABLE,
  ALERT_RULES_TABLE,
} from "../config.js";
import { ALL_STAT_KEYS } from "../types.js";
import type { ResourceItem, EventLogItem } from "../types.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

interface DashboardResource {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string[];
  availableTimestamp: number;
  availableBy: string;
  stats: Record<string, number>;
}

async function fetchAllResources(): Promise<ResourceItem[]> {
  const docClient = createDocClient();
  const items: ResourceItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  // Paginate through all items (DynamoDB returns max 1MB per scan)
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: RESOURCES_TABLE,
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((result.Items ?? []) as ResourceItem[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

function deduplicateResources(items: ResourceItem[]): DashboardResource[] {
  const byId = new Map<string, DashboardResource>();

  for (const item of items) {
    const existing = byId.get(item.resourceId);
    if (existing) {
      if (!existing.planets.includes(item.planet)) {
        existing.planets.push(item.planet);
      }
    } else {
      const stats: Record<string, number> = {};
      for (const key of ALL_STAT_KEYS) {
        if (item[key] !== undefined) {
          stats[key] = item[key] as number;
        }
      }
      byId.set(item.resourceId, {
        resourceId: item.resourceId,
        resourceName: item.resourceName,
        resourceClass: item.resourceClass,
        resourceClassId: item.resourceClassId,
        planets: [item.planet],
        availableTimestamp: item.availableTimestamp,
        availableBy: item.availableBy,
        stats,
      });
    }
  }

  return [...byId.values()];
}

interface DashboardEvent {
  eventType: string;
  resourceName: string;
  resourceClass: string;
  planets: string;
  statSummary: string;
  detectedAt: string;
}

interface DashboardFiredAlert {
  ruleName: string;
  resourceName: string;
  resourceClass: string;
  planets: string;
  stats: Record<string, number>;
  matchedAt: string;
}

interface DashboardAlertRule {
  sk: string;
  name: string;
  classPattern: string;
  stat?: string;
  minValue?: number;
  enabled: boolean;
}

async function fetchTodayEvents(): Promise<DashboardEvent[]> {
  const docClient = createDocClient();
  const today = new Date().toISOString().slice(0, 10);

  const result = await docClient.send(
    new QueryCommand({
      TableName: EVENT_LOG_TABLE,
      KeyConditionExpression: "#d = :date",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":date": today },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []) as DashboardEvent[];
}

async function fetchFiredAlerts(): Promise<DashboardFiredAlert[]> {
  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERT_RULES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "FIRED" },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []) as DashboardFiredAlert[];
}

async function fetchAlertRules(): Promise<DashboardAlertRule[]> {
  const docClient = createDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERT_RULES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "RULE" },
    })
  );

  return (result.Items ?? []) as DashboardAlertRule[];
}

function generateHtml(
  resources: DashboardResource[],
  events: DashboardEvent[],
  firedAlerts: DashboardFiredAlert[],
  alertRules: DashboardAlertRule[]
): string {
  const dataJson = JSON.stringify(resources);
  const eventsJson = JSON.stringify(events);
  const firedAlertsJson = JSON.stringify(firedAlerts);
  const alertRulesJson = JSON.stringify(alertRules);
  const planets = [...new Set(resources.flatMap((r) => r.planets))].sort();
  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SWG Legends Resource Terminal</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0a0e14;
    color: #33cc33;
    font-family: 'Share Tech Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    min-height: 100vh;
    /* Scan line effect */
    background-image:
      repeating-linear-gradient(
        0deg,
        rgba(0, 255, 0, 0.015) 0px,
        rgba(0, 255, 0, 0.015) 1px,
        transparent 1px,
        transparent 3px
      );
  }

  /* ─── Terminal container ─────────────────────────── */
  .terminal {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px;
  }

  /* ─── Header ─────────────────────────────────────── */
  .header {
    border: 1px solid #33cc33;
    padding: 16px 20px;
    margin-bottom: 12px;
    position: relative;
    background: rgba(0, 40, 0, 0.3);
  }

  .header::before {
    content: "\\25C6";
    position: absolute;
    top: -10px;
    left: 12px;
    background: #0a0e14;
    padding: 0 6px;
    color: #ffcc00;
    font-size: 14px;
  }

  .header h1 {
    color: #ffcc00;
    font-size: 20px;
    font-weight: normal;
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 6px;
    text-shadow: 0 0 10px rgba(255, 204, 0, 0.3);
  }

  .header .meta {
    color: #669966;
    font-size: 12px;
  }

  .header .meta span {
    color: #33cc33;
  }

  /* ─── Filter bar ─────────────────────────────────── */
  .filters {
    border: 1px solid #33cc33;
    padding: 12px 20px;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
    background: rgba(0, 40, 0, 0.2);
  }

  .filters::before {
    content: "FILTERS";
    display: block;
    width: 100%;
    color: #ffcc00;
    font-size: 11px;
    letter-spacing: 2px;
    margin-bottom: 4px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .filter-group label {
    color: #669966;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    min-width: 50px;
  }

  select, input[type="text"], input[type="number"] {
    background: #0d1117;
    color: #33cc33;
    border: 1px solid #1a5c1a;
    padding: 6px 10px;
    font-family: 'Share Tech Mono', monospace;
    font-size: 13px;
    outline: none;
  }

  select:focus, input:focus {
    border-color: #33cc33;
    box-shadow: 0 0 6px rgba(51, 204, 51, 0.3);
  }

  select { min-width: 160px; cursor: pointer; }
  input[type="text"] { min-width: 200px; }
  input[type="number"] { width: 80px; }

  /* ─── Planet summary ─────────────────────────────── */
  .planet-summary {
    border: 1px solid #1a5c1a;
    padding: 10px 20px;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    background: rgba(0, 30, 0, 0.2);
  }

  .planet-summary::before {
    content: "PLANETARY SURVEY";
    display: block;
    width: 100%;
    color: #669966;
    font-size: 11px;
    letter-spacing: 2px;
    margin-bottom: 4px;
  }

  .planet-count {
    color: #669966;
    font-size: 12px;
    white-space: nowrap;
  }

  .planet-count .num {
    color: #33cc33;
    font-weight: bold;
  }

  /* ─── Results info ───────────────────────────────── */
  .results-info {
    padding: 8px 20px;
    color: #669966;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
  }

  .results-info .count { color: #ffcc00; }

  /* ─── Table ──────────────────────────────────────── */
  .table-wrapper {
    border: 1px solid #33cc33;
    overflow-x: auto;
    background: rgba(0, 20, 0, 0.2);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    white-space: nowrap;
  }

  thead th {
    background: #0d1a0d;
    color: #ffcc00;
    font-weight: normal;
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 10px 8px;
    text-align: left;
    border-bottom: 1px solid #33cc33;
    cursor: pointer;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  thead th:hover {
    background: #1a2e1a;
    text-shadow: 0 0 6px rgba(255, 204, 0, 0.5);
  }

  thead th.sorted-asc::after { content: " \\25B2"; color: #33cc33; }
  thead th.sorted-desc::after { content: " \\25BC"; color: #33cc33; }

  thead th.stat-col {
    text-align: right;
    min-width: 50px;
  }

  tbody tr {
    border-bottom: 1px solid #0d2a0d;
  }

  tbody tr:nth-child(even) {
    background: rgba(0, 40, 0, 0.1);
  }

  tbody tr:hover {
    background: rgba(51, 204, 51, 0.08);
  }

  td {
    padding: 6px 8px;
    font-size: 13px;
  }

  td.resource-name {
    color: #44dd44;
    font-weight: bold;
  }

  td.resource-class {
    color: #88bb88;
  }

  td.planets-cell {
    color: #669966;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td.stat-cell {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  td.stat-cell.empty {
    color: #1a3a1a;
  }

  td.stat-cell.stat-low {
    color: #cc4444;
    background: rgba(204, 68, 68, 0.08);
  }

  td.stat-cell.stat-mid {
    color: #ccaa33;
    background: rgba(204, 170, 51, 0.05);
  }

  td.stat-cell.stat-high {
    color: #33dd33;
    background: rgba(51, 221, 51, 0.08);
  }

  td.stat-cell.stat-top {
    color: #44ff44;
    background: rgba(68, 255, 68, 0.12);
    text-shadow: 0 0 4px rgba(68, 255, 68, 0.4);
  }

  td.reporter {
    color: #556655;
    font-size: 11px;
  }

  /* ─── Footer ─────────────────────────────────────── */
  .footer {
    padding: 12px 20px;
    color: #334433;
    font-size: 11px;
    text-align: center;
    border-top: 1px solid #1a3a1a;
    margin-top: 12px;
  }

  /* ─── Scrollbar ──────────────────────────────────── */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #0a0e14; }
  ::-webkit-scrollbar-thumb { background: #1a5c1a; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #33cc33; }
</style>
</head>
<body>

<div class="terminal">
  <div class="header">
    <h1>SWG Legends Resource Terminal</h1>
    <div class="meta">
      Server: <span>SWG Legends [138]</span> &nbsp;|&nbsp;
      Resources: <span id="totalCount">${resources.length}</span> &nbsp;|&nbsp;
      Planets: <span>${planets.length}</span> &nbsp;|&nbsp;
      Generated: <span>${generatedAt}</span>
    </div>
  </div>

  <div class="filters">
    <div class="filter-group">
      <label>Planet</label>
      <select id="filterPlanet">
        <option value="">All Planets</option>
        ${planets.map((p) => `<option value="${p}">${p}</option>`).join("\n        ")}
      </select>
    </div>
    <div class="filter-group">
      <label>Class</label>
      <input type="text" id="filterClass" placeholder="Search resource class...">
    </div>
    <div class="filter-group">
      <label>Stat</label>
      <select id="filterStat">
        <option value="">Any</option>
        ${ALL_STAT_KEYS.map((s) => `<option value="${s}">${s.toUpperCase()}</option>`).join("\n        ")}
      </select>
    </div>
    <div class="filter-group">
      <label>Min</label>
      <input type="number" id="filterMin" placeholder="0" min="0" max="1000">
    </div>
  </div>

  <div class="planet-summary" id="planetSummary"></div>

  <div class="results-info">
    <span>Showing <span class="count" id="showingCount">0</span> of <span class="count">${resources.length}</span> resources</span>
    <span>Click column headers to sort</span>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th data-key="resourceName">Name</th>
          <th data-key="resourceClass">Class</th>
          <th data-key="planets">Planets</th>
          ${ALL_STAT_KEYS.map((s) => `<th class="stat-col" data-key="${s}">${s.toUpperCase()}</th>`).join("\n          ")}
          <th data-key="availableBy">Reporter</th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <div class="footer">
    SWG Legends Resource Terminal v2.0 &nbsp;|&nbsp;
    Data source: swgaide.com &nbsp;|&nbsp;
    Generated by swg-legends-localstack-infra
  </div>
</div>

<!-- ─── Event Log + Alerts Panels ──────────────────── -->
<div class="terminal" style="margin-top: 0;">
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">

    <!-- Event Log -->
    <div class="header" style="margin-bottom: 0;">
      <div style="color: #ffcc00; font-size: 14px; letter-spacing: 2px; margin-bottom: 8px;">EVENT LOG (TODAY)</div>
      <div id="eventLogPanel"></div>
    </div>

    <!-- Alerts -->
    <div class="header" style="margin-bottom: 0;">
      <div style="color: #ffcc00; font-size: 14px; letter-spacing: 2px; margin-bottom: 8px;">
        ALERTS <span style="color: #669966; font-size: 11px;">(<span id="ruleCount">0</span> active rules)</span>
      </div>
      <div id="alertsPanel"></div>
    </div>

  </div>
</div>

<script>
const RESOURCES = ${dataJson};
const EVENTS = ${eventsJson};
const FIRED_ALERTS = ${firedAlertsJson};
const ALERT_RULES = ${alertRulesJson};
const STAT_KEYS = ${JSON.stringify(ALL_STAT_KEYS)};

let currentSort = { key: 'oq', dir: 'desc' };
let filtered = [...RESOURCES];

// ─── Filtering ────────────────────────────────────
function applyFilters() {
  const planet = document.getElementById('filterPlanet').value;
  const classSearch = document.getElementById('filterClass').value.toLowerCase();
  const statKey = document.getElementById('filterStat').value;
  const minVal = parseInt(document.getElementById('filterMin').value) || 0;

  filtered = RESOURCES.filter(r => {
    if (planet && !r.planets.includes(planet)) return false;
    if (classSearch && !r.resourceClass.toLowerCase().includes(classSearch)) return false;
    if (statKey && minVal > 0) {
      const val = r.stats[statKey];
      if (val === undefined || val < minVal) return false;
    }
    return true;
  });

  applySort();
  render();
}

// ─── Sorting ──────────────────────────────────────
function applySort() {
  const { key, dir } = currentSort;
  const mult = dir === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let aVal, bVal;

    if (key === 'planets') {
      aVal = a.planets.join(', ');
      bVal = b.planets.join(', ');
    } else if (STAT_KEYS.includes(key)) {
      aVal = a.stats[key] ?? -1;
      bVal = b.stats[key] ?? -1;
      return (aVal - bVal) * mult;
    } else {
      aVal = a[key] ?? '';
      bVal = b[key] ?? '';
    }

    if (typeof aVal === 'string') {
      return aVal.localeCompare(bVal) * mult;
    }
    return (aVal - bVal) * mult;
  });
}

function setSort(key) {
  if (currentSort.key === key) {
    currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort = { key, dir: STAT_KEYS.includes(key) ? 'desc' : 'asc' };
  }
  applySort();
  render();
}

// ─── Stat color class ─────────────────────────────
function statClass(val) {
  if (val === undefined) return 'empty';
  if (val >= 900) return 'stat-top';
  if (val >= 667) return 'stat-high';
  if (val >= 334) return 'stat-mid';
  return 'stat-low';
}

// ─── Render ───────────────────────────────────────
function render() {
  const tbody = document.getElementById('tableBody');
  const showing = document.getElementById('showingCount');

  // Update sort indicators
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.key === currentSort.key) {
      th.classList.add(currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });

  // Update count
  showing.textContent = filtered.length;

  // Build rows
  const rows = filtered.map(r => {
    const statCells = STAT_KEYS.map(s => {
      const val = r.stats[s];
      const cls = statClass(val);
      const display = val !== undefined ? val : '-';
      return '<td class="stat-cell ' + cls + '">' + display + '</td>';
    }).join('');

    return '<tr>' +
      '<td class="resource-name">' + r.resourceName + '</td>' +
      '<td class="resource-class">' + r.resourceClass + '</td>' +
      '<td class="planets-cell" title="' + r.planets.join(', ') + '">' + r.planets.join(', ') + '</td>' +
      statCells +
      '<td class="reporter">' + r.availableBy + '</td>' +
      '</tr>';
  }).join('');

  tbody.innerHTML = rows;

  // Update planet summary
  updatePlanetSummary();
}

function updatePlanetSummary() {
  const counts = {};
  filtered.forEach(r => {
    r.planets.forEach(p => {
      counts[p] = (counts[p] || 0) + 1;
    });
  });

  const summaryEl = document.getElementById('planetSummary');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  summaryEl.innerHTML = sorted.map(([planet, count]) =>
    '<span class="planet-count">' + planet + ': <span class="num">' + count + '</span></span>'
  ).join('');
}

// ─── Event listeners ──────────────────────────────
document.getElementById('filterPlanet').addEventListener('change', applyFilters);
document.getElementById('filterClass').addEventListener('input', applyFilters);
document.getElementById('filterStat').addEventListener('change', applyFilters);
document.getElementById('filterMin').addEventListener('input', applyFilters);

document.querySelectorAll('thead th').forEach(th => {
  th.addEventListener('click', () => setSort(th.dataset.key));
});

// ─── Initial render ───────────────────────────────
applyFilters();
renderEventLog();
renderAlerts();

// ─── Event Log rendering ──────────────────────────
function renderEventLog() {
  const panel = document.getElementById('eventLogPanel');
  if (EVENTS.length === 0) {
    panel.innerHTML = '<div style="color: #334433; font-size: 12px;">No events recorded today.</div>';
    return;
  }

  const rows = EVENTS.slice(0, 20).map(e => {
    const time = e.detectedAt ? e.detectedAt.slice(11, 19) : '';
    let color, symbol, label, detail;
    if (e.eventType === 'SPAWNED') {
      color = '#33cc33'; symbol = '+'; label = 'SPAWNED';
      detail = e.statSummary || '';
    } else if (e.eventType === 'DATA_ISSUE') {
      color = '#ffcc00'; symbol = '!'; label = 'ISSUE';
      detail = e.issue || 'unknown data issue';
    } else {
      color = '#cc4444'; symbol = '-'; label = 'DESPAWN';
      detail = e.statSummary || '';
    }
    return '<div style="margin-bottom: 4px; font-size: 12px;">' +
      '<span style="color: #334433;">' + time + '</span> ' +
      '<span style="color: ' + color + '; font-weight: bold;">' + symbol + ' ' + label + '</span> ' +
      '<span style="color: #44dd44;">' + e.resourceName + '</span> ' +
      '<span style="color: #669966;">(' + e.resourceClass + ')</span> ' +
      '<span style="color: #334433;">[' + e.planets + ']</span>' +
      '<div style="color: ' + (e.eventType === 'DATA_ISSUE' ? '#ffcc00' : '#334433') + '; margin-left: 70px; font-size: 11px;">' + detail + '</div>' +
      '</div>';
  }).join('');

  const countNote = EVENTS.length > 20
    ? '<div style="color: #334433; font-size: 11px; margin-top: 8px;">Showing 20 of ' + EVENTS.length + ' events</div>'
    : '';

  panel.innerHTML = rows + countNote;
}

// ─── Alerts rendering ─────────────────────────────
function renderAlerts() {
  document.getElementById('ruleCount').textContent = ALERT_RULES.length;

  const panel = document.getElementById('alertsPanel');

  // Fired alerts
  let html = '';
  if (FIRED_ALERTS.length === 0) {
    html += '<div style="color: #334433; font-size: 12px; margin-bottom: 12px;">No alerts fired yet.</div>';
  } else {
    html += FIRED_ALERTS.slice(0, 10).map(a => {
      const time = a.matchedAt ? a.matchedAt.replace('T', ' ').slice(0, 19) : '';
      const statsStr = a.stats ? Object.entries(a.stats).map(function(e) { return e[0].toUpperCase() + ':' + e[1]; }).join(' ') : '';
      return '<div style="margin-bottom: 6px; font-size: 12px; border-left: 2px solid #ffcc00; padding-left: 8px;">' +
        '<span style="color: #cc4444; font-weight: bold;">!</span> ' +
        '<span style="color: #ffcc00;">[' + a.ruleName + ']</span> ' +
        '<span style="color: #44dd44;">' + a.resourceName + '</span> ' +
        '<span style="color: #669966;">(' + a.resourceClass + ')</span>' +
        '<div style="color: #334433; font-size: 11px;">' + time + ' | ' + a.planets + ' | ' + statsStr + '</div>' +
        '</div>';
    }).join('');

    if (FIRED_ALERTS.length > 10) {
      html += '<div style="color: #334433; font-size: 11px;">Showing 10 of ' + FIRED_ALERTS.length + ' alerts</div>';
    }
  }

  // Active rules
  if (ALERT_RULES.length > 0) {
    html += '<div style="color: #669966; font-size: 11px; letter-spacing: 1px; margin-top: 12px; margin-bottom: 6px;">ACTIVE RULES</div>';
    html += ALERT_RULES.map(r => {
      const statInfo = r.stat && r.minValue !== undefined ? ' ' + r.stat.toUpperCase() + '>=' + r.minValue : '';
      return '<div style="font-size: 12px; color: #669966;">' +
        '<span style="color: #ffcc00;">' + r.name + '</span>' +
        ' <span style="color: #334433;">class="' + r.classPattern + '"' + statInfo + '</span>' +
        '</div>';
    }).join('');
  }

  panel.innerHTML = html;
}
</script>

</body>
</html>`;
}

async function main(): Promise<void> {
  console.log("=== Generate Resource Dashboard ===\n");

  console.log("  Fetching resources from DynamoDB...");
  const items = await fetchAllResources();
  console.log(`  Fetched ${items.length} items`);

  console.log("  Deduplicating multi-planet resources...");
  const resources = deduplicateResources(items);
  console.log(`  ${resources.length} unique resources`);

  console.log("  Fetching today's events...");
  const events = await fetchTodayEvents();
  console.log(`  ${events.length} events`);

  console.log("  Fetching alert rules and history...");
  const firedAlerts = await fetchFiredAlerts();
  const alertRules = await fetchAlertRules();
  console.log(`  ${alertRules.length} rules, ${firedAlerts.length} fired alerts`);

  console.log("  Generating HTML...");
  const html = generateHtml(resources, events, firedAlerts, alertRules);

  const outputDir = "data";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = `${outputDir}/dashboard.html`;
  writeFileSync(outputPath, html);
  console.log(`  Written to ${outputPath} (${Math.round(html.length / 1024)} KB)`);

  // Open in browser (macOS)
  console.log("  Opening in browser...");
  try {
    execSync(`open ${outputPath}`);
  } catch {
    console.log(`  Could not auto-open. Open manually: ${outputPath}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Dashboard generation failed:", err);
  process.exit(1);
});
