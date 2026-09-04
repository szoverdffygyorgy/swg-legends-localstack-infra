import { useState, useEffect, useRef } from "react";
import { useOpsDashboard } from "../api/hooks";
import type {
  PipelineExecution,
  LogEntry,
} from "../api/types";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Ops.css";

// ─── Constants ───────────────────────────────────────────────────────

const LAMBDA_FUNCTIONS = [
  "api-get-resources", "api-get-events", "api-alerts", "api-pipeline-status", "api-ops-dashboard",
  "alert-evaluator", "history-recorder",
  "pipeline-download", "pipeline-parse", "pipeline-diff", "pipeline-update-db",
  "pipeline-log-events", "pipeline-publish-sns", "pipeline-archive",
];

// ─── Helpers ─────────────────────────────────────────────────────────

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "--";
  return iso.replace("T", " ").slice(0, 19);
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(11, 23);
}

function statusVariant(status: string): "ok" | "error" | "warn" | "info" {
  switch (status) {
    case "SUCCEEDED": return "ok";
    case "FAILED": case "TIMED_OUT": case "ABORTED": return "error";
    case "RUNNING": return "warn";
    default: return "info";
  }
}

function stepIcon(status: string): string {
  if (status === "succeeded") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u25B8";
}

function stepClass(status: string): string {
  if (status === "succeeded") return "step--ok";
  if (status === "failed") return "step--error";
  return "step--running";
}

function lambdaGroup(name: string): string {
  if (name.startsWith("api-")) return "API";
  if (name.startsWith("pipeline-")) return "Pipeline";
  return "Compute";
}

// ─── Component ───────────────────────────────────────────────────────

export default function Ops() {
  const [logFunction, setLogFunction] = useState("pipeline-archive");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedExec, setExpandedExec] = useState<Set<string>>(() => new Set());
  const hasAutoExpanded = useRef(false);

  const { data, isLoading, isFetching, error, refetch } = useOpsDashboard(logFunction, autoRefresh);

  // Auto-enable refresh if a pipeline is running
  useEffect(() => {
    if (data?.executions.some((e) => e.status === "RUNNING") && !autoRefresh) {
      setAutoRefresh(true);
    }
  }, [data, autoRefresh]);

  // Auto-expand first execution on initial data load (once only)
  useEffect(() => {
    if (data?.executions.length && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      setExpandedExec(new Set([data.executions[0].executionArn]));
    }
  }, [data]);

  function toggleExpand(arn: string) {
    setExpandedExec((prev) => {
      const next = new Set(prev);
      if (next.has(arn)) next.delete(arn); else next.add(arn);
      return next;
    });
  }

  if (isLoading && !data) return <LoadingSpinner message="Loading ops dashboard..." />;
  if (error && !data) return <ErrorMessage message={error instanceof Error ? error.message : "Failed to load ops dashboard"} onRetry={() => refetch()} />;
  if (!data) return null;

  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqMessages, 0);
  const totalPending = data.queues.reduce((sum, q) => sum + q.pending, 0);
  const totalErrors = data.lambdaMetrics.reduce((sum, m) => sum + m.errors, 0);

  return (
    <div className="ops-page">
      {/* ─── System Health Bar ─────────────────────────────── */}
      <div className="health-bar">
        <div className="health-item">
          <span className="health-label">Pipeline</span>
          {data.lastSync ? (
            <StatusBadge variant={statusVariant(data.lastSync.status)}>
              {data.lastSync.status} {timeAgo(data.lastSync.syncedAt)}
            </StatusBadge>
          ) : (
            <StatusBadge variant="info">No data</StatusBadge>
          )}
        </div>
        <div className="health-item">
          <span className="health-label">Errors (24h)</span>
          <StatusBadge variant={totalErrors > 0 ? "error" : "ok"}>
            {totalErrors}
          </StatusBadge>
        </div>
        <div className="health-item">
          <span className="health-label">Queue Pending</span>
          <StatusBadge variant={totalPending > 0 ? "warn" : "ok"}>
            {totalPending}
          </StatusBadge>
        </div>
        <div className="health-item">
          <span className="health-label">DLQ</span>
          <StatusBadge variant={totalDlq > 0 ? "error" : "ok"}>
            {totalDlq} messages
          </StatusBadge>
        </div>
        <div className="health-item health-item--right">
          {isFetching && !isLoading && (
            <span className="refreshing-indicator">Refreshing...</span>
          )}
          <button
            className={`btn-refresh ${autoRefresh ? "btn-refresh--active" : ""}`}
            onClick={() => setAutoRefresh((p) => !p)}
          >
            {autoRefresh ? "Auto-refresh: ON" : "Auto-refresh: OFF"}
          </button>
        </div>
      </div>

      {/* ─── Pipeline Status ──────────────────────────────── */}
      <div className="ops-section">
        <h2 className="ops-section-title">
          Pipeline
          <span className="section-count">{data.executions.length}</span>
        </h2>
        {data.lastSync && (
          <div className="sync-summary">
            <span className="sync-label">Last synced:</span>
            <span className="sync-time">{timeAgo(data.lastSync.syncedAt)}</span>
            <span className="sync-date">({formatTime(data.lastSync.syncedAt)})</span>
            <span className="sync-stats">
              {data.lastSync.spawnedCount} spawned, {data.lastSync.despawnedCount} despawned, {data.lastSync.unchangedCount} unchanged
            </span>
          </div>
        )}
        {data.executions.length > 0 && (
          <div className="executions-list">
            {data.executions.map((exec) => (
              <ExecutionCard
                key={exec.executionArn}
                exec={exec}
                expanded={expandedExec.has(exec.executionArn)}
                onToggle={() => toggleExpand(exec.executionArn)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="ops-row">
        {/* ─── Lambda Metrics ───────────────────────────────── */}
        <div className="ops-section ops-section--half">
          <h2 className="ops-section-title">Lambda Metrics (24h)</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Group</th>
                  <th className="col-right">Invocations</th>
                  <th className="col-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.lambdaMetrics
                  .filter((m) => m.invocations > 0 || m.errors > 0)
                  .sort((a, b) => b.invocations - a.invocations)
                  .map((m) => (
                    <tr key={m.name}>
                      <td className="cell-fn">{m.name}</td>
                      <td className="cell-group">{lambdaGroup(m.name)}</td>
                      <td className="col-right cell-metric">{m.invocations}</td>
                      <td className={`col-right cell-metric ${m.errors > 0 ? "cell-metric--error" : ""}`}>
                        {m.errors}
                      </td>
                    </tr>
                  ))}
                {data.lambdaMetrics.every((m) => m.invocations === 0 && m.errors === 0) && (
                  <tr><td colSpan={4} className="empty-cell">No invocations in the last 24h</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── SQS Queues ───────────────────────────────────── */}
        <div className="ops-section ops-section--half">
          <h2 className="ops-section-title">SQS Queues</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th className="col-right">Pending</th>
                  <th className="col-right">In-Flight</th>
                  <th className="col-right">DLQ</th>
                </tr>
              </thead>
              <tbody>
                {data.queues.map((q) => (
                  <tr key={q.name}>
                    <td className="cell-fn">{q.name}</td>
                    <td className="col-right cell-metric">{q.pending}</td>
                    <td className="col-right cell-metric">{q.inFlight}</td>
                    <td className={`col-right cell-metric ${q.dlqMessages > 0 ? "cell-metric--error" : ""}`}>
                      {q.dlqMessages}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Recent Logs ────────────────────────────────────── */}
      <div className="ops-section">
        <h2 className="ops-section-title">
          Recent Logs
          <span className="section-count">{data.recentLogs.length}</span>
        </h2>
        <div className="log-controls">
          <select
            value={logFunction}
            onChange={(e) => setLogFunction(e.target.value)}
          >
            {LAMBDA_FUNCTIONS.map((fn) => (
              <option key={fn} value={fn}>{fn}</option>
            ))}
          </select>
        </div>
        <div className="log-viewer">
          {data.recentLogs.length === 0 ? (
            <div className="log-empty">No logs available for {logFunction}</div>
          ) : (
            data.recentLogs.map((entry, i) => (
              <LogLine key={i} entry={entry} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function ExecutionCard({
  exec, expanded, onToggle,
}: {
  exec: PipelineExecution; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div className={`execution-card execution-card--${exec.status.toLowerCase()}`}>
      <div className="execution-header" onClick={onToggle}>
        <span className="execution-chevron">{expanded ? "\u25BE" : "\u25B8"}</span>
        <StatusBadge variant={statusVariant(exec.status)}>{exec.status}</StatusBadge>
        <span className="execution-time">{formatTime(exec.startedAt)}</span>
        {exec.duration && <span className="execution-duration">({exec.duration})</span>}
        {exec.steps.length > 0 && (
          <span className="execution-step-count">
            {exec.steps.filter((s) => s.status === "succeeded").length}/{exec.steps.length} steps
          </span>
        )}
      </div>
      {expanded && (
        <div className="execution-detail">
          {exec.steps.length > 0 && (
            <div className="execution-steps">
              {exec.steps.map((step, i) => (
                <div key={i} className={`step ${stepClass(step.status)}`}>
                  <span className="step-icon">{stepIcon(step.status)}</span>
                  <span className="step-name">{step.name}</span>
                </div>
              ))}
            </div>
          )}
          {exec.error && (
            <div className="execution-error">
              <span className="error-label">Error:</span> {exec.error}
              {exec.cause && <><br /><span className="error-label">Cause:</span> {exec.cause}</>}
            </div>
          )}
          {exec.output && (exec.output as Record<string, unknown>).archiveS3Key ? (
            <div className="execution-output">
              Archive: <code>{String((exec.output as Record<string, unknown>).archiveS3Key)}</code>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const msg = entry.message;
  const isReport = msg.startsWith("REPORT ");
  const isError = msg.includes("ERROR") || msg.includes("Error");
  const isWarn = msg.includes("Warning") || msg.includes("WARN");

  const lineClass = isError ? "log-line--error"
    : isWarn ? "log-line--warn"
    : isReport ? "log-line--report"
    : "";

  return (
    <div className={`log-line ${lineClass}`}>
      <span className="log-ts">{formatTimestamp(entry.timestamp)}</span>
      <span className="log-msg">{msg}</span>
    </div>
  );
}
