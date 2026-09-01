/**
 * Generates an Operations Dashboard HTML page.
 *
 * Queries LocalStack for real operational data across all services
 * and generates a self-contained HTML file styled to match the
 * Bazaar Terminal aesthetic from the resource dashboard.
 *
 * Sections:
 * 1. System Health -- service availability status
 * 2. Pipeline History -- recent Step Functions executions
 * 3. Infrastructure Inventory -- Lambda, DynamoDB, SQS, S3 stats
 * 4. Alert Status -- active rules, recent fired alerts, EventBridge schedule
 * 5. API Routes -- configured API Gateway endpoints
 *
 * Run with: npm run dashboard:ops
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  SQSClient,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  SFNClient,
  ListStateMachinesCommand,
  ListExecutionsCommand,
} from "@aws-sdk/client-sfn";
import {
  CloudWatchEventsClient,
  ListRulesCommand,
} from "@aws-sdk/client-cloudwatch-events";
import {
  LOCALSTACK_ENDPOINT,
  AWS_REGION,
  ALERT_RULES_TABLE,
} from "../config.js";

// ─── Shared client config ────────────────────────────────────────────

const clientConfig = {
  endpoint: LOCALSTACK_ENDPOINT,
  region: AWS_REGION,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

const lambda = new LambdaClient(clientConfig);
const ddb = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient(clientConfig);
const s3 = new S3Client({ ...clientConfig, forcePathStyle: true });
const sfn = new SFNClient(clientConfig);
const events = new CloudWatchEventsClient(clientConfig);

// ─── Data collection ─────────────────────────────────────────────────

interface LambdaInfo {
  name: string;
  runtime: string;
  memoryMB: number;
  timeoutSec: number;
  codeSize: string;
  lastModified: string;
}

interface TableInfo {
  name: string;
  itemCount: number;
  sizeBytes: number;
}

interface QueueInfo {
  name: string;
  messagesAvailable: number;
  messagesInFlight: number;
  isDLQ: boolean;
}

interface PipelineExecution {
  status: string;
  startDate: string;
  stopDate: string;
  duration: string;
  executionArn: string;
}

interface AlertRule {
  name: string;
  classPattern: string;
  stat?: string;
  minValue?: number;
  enabled: boolean;
}

interface FiredAlert {
  ruleName: string;
  resourceName: string;
  resourceClass: string;
  matchedAt: string;
}

interface EventBridgeRule {
  name: string;
  scheduleExpression?: string;
  state: string;
  description?: string;
}

async function collectLambdas(): Promise<LambdaInfo[]> {
  try {
    const result = await lambda.send(new ListFunctionsCommand({}));
    return (result.Functions ?? []).map((f) => ({
      name: f.FunctionName ?? "unknown",
      runtime: f.Runtime ?? "unknown",
      memoryMB: f.MemorySize ?? 0,
      timeoutSec: f.Timeout ?? 0,
      codeSize: `${Math.round((f.CodeSize ?? 0) / 1024)} KB`,
      lastModified: f.LastModified?.slice(0, 19) ?? "",
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function collectTables(): Promise<TableInfo[]> {
  const tableNames = ["resources", "resource-history", "event-log", "alert-rules"];
  const tables: TableInfo[] = [];

  for (const name of tableNames) {
    try {
      const result = await ddb.send(new DescribeTableCommand({ TableName: name }));
      tables.push({
        name,
        itemCount: result.Table?.ItemCount ?? 0,
        sizeBytes: result.Table?.TableSizeBytes ?? 0,
      });
    } catch {
      tables.push({ name, itemCount: -1, sizeBytes: 0 });
    }
  }

  return tables;
}

async function collectQueues(): Promise<QueueInfo[]> {
  const queueNames = [
    "alert-evaluator",
    "history-recorder",
    "alert-evaluator-dlq",
    "history-recorder-dlq",
  ];
  const queues: QueueInfo[] = [];

  for (const name of queueNames) {
    try {
      const url = `${LOCALSTACK_ENDPOINT}/000000000000/${name}`;
      const result = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: [
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
          ],
        })
      );
      queues.push({
        name,
        messagesAvailable: Number(
          result.Attributes?.ApproximateNumberOfMessages ?? 0
        ),
        messagesInFlight: Number(
          result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0
        ),
        isDLQ: name.includes("dlq"),
      });
    } catch {
      queues.push({ name, messagesAvailable: -1, messagesInFlight: 0, isDLQ: name.includes("dlq") });
    }
  }

  return queues;
}

async function collectS3Archives(): Promise<number> {
  try {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: "swg-legends-raw-exports",
        Prefix: "exports/",
      })
    );
    return result.KeyCount ?? 0;
  } catch {
    return 0;
  }
}

async function collectExecutions(): Promise<PipelineExecution[]> {
  try {
    const machines = await sfn.send(new ListStateMachinesCommand({}));
    const pipeline = machines.stateMachines?.find(
      (m) => m.name === "swg-legends-ingestion-pipeline"
    );
    if (!pipeline?.stateMachineArn) return [];

    const result = await sfn.send(
      new ListExecutionsCommand({
        stateMachineArn: pipeline.stateMachineArn,
        maxResults: 10,
      })
    );

    return (result.executions ?? []).map((e) => {
      const start = e.startDate ?? new Date();
      const stop = e.stopDate;
      const durationMs = stop
        ? stop.getTime() - start.getTime()
        : Date.now() - start.getTime();

      return {
        status: e.status ?? "UNKNOWN",
        startDate: start.toISOString().slice(0, 19).replace("T", " "),
        stopDate: stop?.toISOString().slice(0, 19).replace("T", " ") ?? "",
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        executionArn: e.executionArn ?? "",
      };
    });
  } catch {
    return [];
  }
}

async function collectAlertRules(): Promise<AlertRule[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: ALERT_RULES_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "RULE" },
      })
    );
    return (result.Items ?? []).map((item) => ({
      name: item.name as string,
      classPattern: item.classPattern as string,
      stat: item.stat as string | undefined,
      minValue: item.minValue as number | undefined,
      enabled: item.enabled as boolean,
    }));
  } catch {
    return [];
  }
}

async function collectFiredAlerts(): Promise<FiredAlert[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: ALERT_RULES_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "FIRED" },
        ScanIndexForward: false,
        Limit: 10,
      })
    );
    return (result.Items ?? []).map((item) => ({
      ruleName: item.ruleName as string,
      resourceName: item.resourceName as string,
      resourceClass: item.resourceClass as string,
      matchedAt: ((item.matchedAt as string) ?? "").slice(0, 19).replace("T", " "),
    }));
  } catch {
    return [];
  }
}

async function collectEventBridgeRules(): Promise<EventBridgeRule[]> {
  try {
    const result = await events.send(new ListRulesCommand({}));
    return (result.Rules ?? []).map((r) => ({
      name: r.Name ?? "unknown",
      scheduleExpression: r.ScheduleExpression,
      state: r.State ?? "UNKNOWN",
      description: r.Description,
    }));
  } catch {
    return [];
  }
}

// ─── HTML generation ─────────────────────────────────────────────────

function statusDot(ok: boolean): string {
  const color = ok ? "#33cc33" : "#cc4444";
  return `<span style="color: ${color}; text-shadow: 0 0 6px ${color}40;">&#9679;</span>`;
}

function executionStatusColor(status: string): string {
  switch (status) {
    case "SUCCEEDED": return "#33cc33";
    case "FAILED": case "TIMED_OUT": case "ABORTED": return "#cc4444";
    case "RUNNING": return "#ffcc00";
    default: return "#669966";
  }
}

function generateHtml(data: {
  lambdas: LambdaInfo[];
  tables: TableInfo[];
  queues: QueueInfo[];
  s3ArchiveCount: number;
  executions: PipelineExecution[];
  alertRules: AlertRule[];
  firedAlerts: FiredAlert[];
  eventBridgeRules: EventBridgeRule[];
}): string {
  const generatedAt = new Date().toISOString();

  // Service health
  const lambdaOk = data.lambdas.length > 0;
  const dynamoOk = data.tables.every((t) => t.itemCount >= 0);
  const sqsOk = data.queues.every((q) => q.messagesAvailable >= 0);
  const s3Ok = data.s3ArchiveCount >= 0;
  const sfnOk = data.executions.length > 0;
  const ebOk = data.eventBridgeRules.length > 0;

  // DLQ health
  const dlqMessages = data.queues
    .filter((q) => q.isDLQ)
    .reduce((sum, q) => sum + Math.max(q.messagesAvailable, 0), 0);

  // Pipeline stats
  const recentSuccesses = data.executions.filter((e) => e.status === "SUCCEEDED").length;
  const recentFailures = data.executions.filter((e) => e.status === "FAILED").length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SWG Legends Ops Dashboard</title>
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
    background-image:
      repeating-linear-gradient(
        0deg,
        rgba(0, 255, 0, 0.015) 0px,
        rgba(0, 255, 0, 0.015) 1px,
        transparent 1px,
        transparent 3px
      );
  }

  .terminal { max-width: 1400px; margin: 0 auto; padding: 16px; }

  .header {
    border: 1px solid #33cc33;
    padding: 16px 20px;
    margin-bottom: 12px;
    background: rgba(0, 40, 0, 0.3);
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

  .header .meta { color: #669966; font-size: 12px; }
  .header .meta span { color: #33cc33; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }

  .panel {
    border: 1px solid #1a5c1a;
    padding: 12px 16px;
    background: rgba(0, 30, 0, 0.2);
  }

  .panel-title {
    color: #ffcc00;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .health-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid #0d2a0d;
  }

  .health-row:last-child { border-bottom: none; }
  .health-label { color: #669966; }
  .health-value { color: #33cc33; }

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
    padding: 8px 8px;
    text-align: left;
    border-bottom: 1px solid #33cc33;
  }

  tbody tr { border-bottom: 1px solid #0d2a0d; }
  tbody tr:nth-child(even) { background: rgba(0, 40, 0, 0.1); }
  td { padding: 5px 8px; font-size: 12px; }

  .status-badge {
    display: inline-block;
    padding: 1px 8px;
    font-size: 11px;
    letter-spacing: 1px;
    border: 1px solid;
  }

  .badge-ok { color: #33cc33; border-color: #1a5c1a; background: rgba(51, 204, 51, 0.1); }
  .badge-warn { color: #ffcc00; border-color: #665500; background: rgba(255, 204, 0, 0.1); }
  .badge-err { color: #cc4444; border-color: #5c1a1a; background: rgba(204, 68, 68, 0.1); }
  .badge-info { color: #669966; border-color: #1a3a1a; background: rgba(0, 40, 0, 0.2); }

  .footer {
    padding: 12px 20px;
    color: #334433;
    font-size: 11px;
    text-align: center;
    border-top: 1px solid #1a3a1a;
    margin-top: 12px;
  }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #0a0e14; }
  ::-webkit-scrollbar-thumb { background: #1a5c1a; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #33cc33; }
</style>
</head>
<body>

<div class="terminal">
  <div class="header">
    <h1>SWG Legends Ops Dashboard</h1>
    <div class="meta">
      Infrastructure Status &nbsp;|&nbsp;
      Lambdas: <span>${data.lambdas.length}</span> &nbsp;|&nbsp;
      Tables: <span>${data.tables.length}</span> &nbsp;|&nbsp;
      Queues: <span>${data.queues.length}</span> &nbsp;|&nbsp;
      Generated: <span>${generatedAt}</span>
    </div>
  </div>

  <!-- ═══ System Health ═══════════════════════════════════════════ -->
  <div class="grid">
    <div class="panel">
      <div class="panel-title">System Health</div>
      <div class="health-row">
        <span class="health-label">${statusDot(lambdaOk)} Lambda Functions</span>
        <span class="health-value">${data.lambdas.length} deployed</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(dynamoOk)} DynamoDB Tables</span>
        <span class="health-value">${data.tables.filter((t) => t.itemCount >= 0).length}/${data.tables.length} accessible</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(sqsOk)} SQS Queues</span>
        <span class="health-value">${data.queues.filter((q) => !q.isDLQ).length} active + ${data.queues.filter((q) => q.isDLQ).length} DLQs</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(s3Ok)} S3 Archives</span>
        <span class="health-value">${data.s3ArchiveCount} exports stored</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(sfnOk)} Step Functions</span>
        <span class="health-value">${recentSuccesses} ok / ${recentFailures} failed (last 10)</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(ebOk)} EventBridge</span>
        <span class="health-value">${data.eventBridgeRules.length} rules active</span>
      </div>
      <div class="health-row">
        <span class="health-label">${statusDot(dlqMessages === 0)} Dead Letter Queues</span>
        <span class="health-value" style="color: ${dlqMessages > 0 ? "#cc4444" : "#33cc33"}">${dlqMessages} messages</span>
      </div>
    </div>

    <!-- ═══ EventBridge Schedule ════════════════════════════════════ -->
    <div class="panel">
      <div class="panel-title">EventBridge Rules</div>
      ${data.eventBridgeRules.length === 0
        ? '<div style="color: #334433; font-size: 12px;">No EventBridge rules found.</div>'
        : data.eventBridgeRules.map((r) => `
        <div class="health-row">
          <span class="health-label">${r.name}</span>
          <span class="health-value">
            <span class="status-badge ${r.state === "ENABLED" ? "badge-ok" : "badge-warn"}">${r.state}</span>
            ${r.scheduleExpression ? `<span style="color: #669966; margin-left: 8px;">${r.scheduleExpression}</span>` : ""}
          </span>
        </div>
        ${r.description ? `<div style="color: #334433; font-size: 11px; padding-left: 4px; margin-bottom: 4px;">${r.description}</div>` : ""}
      `).join("")}

      <div class="panel-title" style="margin-top: 16px;">Alert Rules</div>
      ${data.alertRules.length === 0
        ? '<div style="color: #334433; font-size: 12px;">No alert rules defined.</div>'
        : data.alertRules.map((r) => `
        <div class="health-row">
          <span style="color: #ffcc00;">${r.name}</span>
          <span style="color: #669966;">class="${r.classPattern}"${r.stat ? ` ${r.stat.toUpperCase()}>=${r.minValue}` : ""}</span>
        </div>
      `).join("")}
    </div>
  </div>

  <!-- ═══ Pipeline Execution History ════════════════════════════════ -->
  <div class="panel" style="margin-bottom: 12px;">
    <div class="panel-title">Pipeline Execution History (Last 10)</div>
    ${data.executions.length === 0
      ? '<div style="color: #334433; font-size: 12px;">No pipeline executions found. Run: npm run pipeline:start</div>'
      : `<table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Started</th>
          <th>Stopped</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${data.executions.map((e) => `
        <tr>
          <td><span class="status-badge ${e.status === "SUCCEEDED" ? "badge-ok" : e.status === "RUNNING" ? "badge-warn" : "badge-err"}">${e.status}</span></td>
          <td style="color: #669966;">${e.startDate}</td>
          <td style="color: #669966;">${e.stopDate || "—"}</td>
          <td style="color: ${e.status === "SUCCEEDED" ? "#33cc33" : "#669966"};">${e.duration}</td>
        </tr>
        `).join("")}
      </tbody>
    </table>`}
  </div>

  <!-- ═══ Infrastructure Inventory ═══════════════════════════════════ -->
  <div class="grid">
    <!-- Lambda Functions -->
    <div class="panel">
      <div class="panel-title">Lambda Functions (${data.lambdas.length})</div>
      <table>
        <thead>
          <tr>
            <th>Function</th>
            <th>Runtime</th>
            <th>Memory</th>
            <th>Timeout</th>
            <th>Code Size</th>
          </tr>
        </thead>
        <tbody>
          ${data.lambdas.map((l) => {
            const phase = l.name.startsWith("pipeline-") ? "P5" :
                          l.name.startsWith("api-") ? "P4" : "P3";
            return `
          <tr>
            <td style="color: #44dd44;"><span class="status-badge badge-info">${phase}</span> ${l.name}</td>
            <td style="color: #669966;">${l.runtime}</td>
            <td style="color: #669966;">${l.memoryMB} MB</td>
            <td style="color: #669966;">${l.timeoutSec}s</td>
            <td style="color: #669966;">${l.codeSize}</td>
          </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <!-- DynamoDB + SQS + S3 -->
    <div class="panel">
      <div class="panel-title">DynamoDB Tables</div>
      <table>
        <thead>
          <tr><th>Table</th><th>Items</th><th>Size</th></tr>
        </thead>
        <tbody>
          ${data.tables.map((t) => `
          <tr>
            <td style="color: #44dd44;">${t.name}</td>
            <td style="color: ${t.itemCount < 0 ? "#cc4444" : "#33cc33"};">${t.itemCount < 0 ? "ERR" : t.itemCount.toLocaleString()}</td>
            <td style="color: #669966;">${t.sizeBytes > 0 ? `${Math.round(t.sizeBytes / 1024)} KB` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>

      <div class="panel-title" style="margin-top: 16px;">SQS Queues</div>
      <table>
        <thead>
          <tr><th>Queue</th><th>Available</th><th>In Flight</th></tr>
        </thead>
        <tbody>
          ${data.queues.map((q) => `
          <tr>
            <td style="color: ${q.isDLQ ? "#ffcc00" : "#44dd44"};">${q.isDLQ ? "DLQ " : ""}${q.name}</td>
            <td style="color: ${q.messagesAvailable > 0 ? (q.isDLQ ? "#cc4444" : "#ffcc00") : "#33cc33"};">${q.messagesAvailable < 0 ? "ERR" : q.messagesAvailable}</td>
            <td style="color: #669966;">${q.messagesInFlight}</td>
          </tr>`).join("")}
        </tbody>
      </table>

      <div class="panel-title" style="margin-top: 16px;">S3 Archives</div>
      <div class="health-row">
        <span class="health-label">swg-legends-raw-exports/exports/</span>
        <span class="health-value">${data.s3ArchiveCount} snapshots</span>
      </div>
    </div>
  </div>

  <!-- ═══ Recent Fired Alerts ════════════════════════════════════════ -->
  ${data.firedAlerts.length > 0 ? `
  <div class="panel" style="margin-bottom: 12px;">
    <div class="panel-title">Recent Fired Alerts (Last 10)</div>
    <table>
      <thead>
        <tr><th>Rule</th><th>Resource</th><th>Class</th><th>Matched At</th></tr>
      </thead>
      <tbody>
        ${data.firedAlerts.map((a) => `
        <tr>
          <td style="color: #ffcc00;">${a.ruleName}</td>
          <td style="color: #44dd44;">${a.resourceName}</td>
          <td style="color: #669966;">${a.resourceClass}</td>
          <td style="color: #669966;">${a.matchedAt}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  ` : ""}

  <div class="footer">
    SWG Legends Operations Dashboard v1.0 &nbsp;|&nbsp;
    Phase 6: Events & Monitoring &nbsp;|&nbsp;
    Generated by swg-legends-localstack-infra
  </div>
</div>

</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Generate Operations Dashboard ===\n");

  console.log("  Collecting Lambda functions...");
  const lambdas = await collectLambdas();
  console.log(`  ${lambdas.length} functions`);

  console.log("  Collecting DynamoDB tables...");
  const tables = await collectTables();
  console.log(`  ${tables.length} tables`);

  console.log("  Collecting SQS queues...");
  const queues = await collectQueues();
  console.log(`  ${queues.length} queues`);

  console.log("  Collecting S3 archives...");
  const s3ArchiveCount = await collectS3Archives();
  console.log(`  ${s3ArchiveCount} archives`);

  console.log("  Collecting pipeline executions...");
  const executions = await collectExecutions();
  console.log(`  ${executions.length} executions`);

  console.log("  Collecting alert rules...");
  const alertRules = await collectAlertRules();
  console.log(`  ${alertRules.length} rules`);

  console.log("  Collecting fired alerts...");
  const firedAlerts = await collectFiredAlerts();
  console.log(`  ${firedAlerts.length} fired alerts`);

  console.log("  Collecting EventBridge rules...");
  const eventBridgeRules = await collectEventBridgeRules();
  console.log(`  ${eventBridgeRules.length} rules`);

  console.log("  Generating HTML...");
  const html = generateHtml({
    lambdas,
    tables,
    queues,
    s3ArchiveCount,
    executions,
    alertRules,
    firedAlerts,
    eventBridgeRules,
  });

  const outputDir = "data";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = `${outputDir}/ops-dashboard.html`;
  writeFileSync(outputPath, html);
  console.log(`  Written to ${outputPath} (${Math.round(html.length / 1024)} KB)`);

  console.log("  Opening in browser...");
  try {
    execSync(`open ${outputPath}`);
  } catch {
    console.log(`  Could not auto-open. Open manually: ${outputPath}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Ops dashboard generation failed:", err);
  process.exit(1);
});
