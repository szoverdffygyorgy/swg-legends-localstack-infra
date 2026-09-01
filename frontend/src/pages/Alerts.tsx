import { useState, useEffect, useCallback } from "react";
import {
  getAlertRules,
  createAlertRule,
  deleteAlertRule,
  getAlertHistory,
} from "../api/client";
import type { AlertRule, FiredAlert } from "../api/types";
import { STAT_KEYS } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Alerts.css";

export default function Alerts() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [firedAlerts, setFiredAlerts] = useState<FiredAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [formName, setFormName] = useState("");
  const [formClass, setFormClass] = useState("");
  const [formStat, setFormStat] = useState("");
  const [formMin, setFormMin] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesData, historyData] = await Promise.all([
        getAlertRules(),
        getAlertHistory(),
      ]);
      setRules(rulesData.rules);
      setFiredAlerts(historyData.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const body: Parameters<typeof createAlertRule>[0] = {
        name: formName,
        classPattern: formClass,
      };
      if (formStat) body.stat = formStat;
      if (formStat && formMin) body.minValue = Number(formMin);

      await createAlertRule(body);
      setFormName("");
      setFormClass("");
      setFormStat("");
      setFormMin("");
      await fetchData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(ruleId: string) {
    try {
      await deleteAlertRule(ruleId);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  function formatTime(iso: string): string {
    return iso.replace("T", " ").slice(0, 19);
  }

  if (loading) return <LoadingSpinner message="Loading alerts..." />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  return (
    <div className="alerts-page">
      {/* ─── Create Rule Form ──────────────────────────────── */}
      <div className="alerts-section">
        <h2 className="section-title">Create Alert Rule</h2>
        <form className="create-form" onSubmit={handleCreate}>
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                placeholder='e.g., "Good Copper"'
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Class Pattern *</label>
              <input
                type="text"
                placeholder='e.g., "Copper"'
                value={formClass}
                onChange={(e) => setFormClass(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Stat</label>
              <select value={formStat} onChange={(e) => setFormStat(e.target.value)}>
                <option value="">None</option>
                {STAT_KEYS.map((s) => (
                  <option key={s} value={s}>{s.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Min Value</label>
              <input
                type="number"
                placeholder="0"
                min="0"
                max="1000"
                value={formMin}
                onChange={(e) => setFormMin(e.target.value)}
                disabled={!formStat}
              />
            </div>
            <button type="submit" className="btn-create" disabled={creating}>
              {creating ? "Creating..." : "Create Rule"}
            </button>
          </div>
          {createError && (
            <div className="form-error">{createError}</div>
          )}
        </form>
      </div>

      {/* ─── Active Rules ──────────────────────────────────── */}
      <div className="alerts-section">
        <h2 className="section-title">
          Active Rules
          <span className="section-count">{rules.length}</span>
        </h2>
        {rules.length === 0 ? (
          <div className="empty-state">
            No alert rules defined. Create one above.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Class Pattern</th>
                  <th>Stat</th>
                  <th>Min</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td className="cell-name">{rule.name}</td>
                    <td>{rule.classPattern}</td>
                    <td className="cell-stat-label">
                      {rule.stat?.toUpperCase() ?? "\u2014"}
                    </td>
                    <td className="cell-stat-label">
                      {rule.minValue ?? "\u2014"}
                    </td>
                    <td>
                      <StatusBadge variant={rule.enabled ? "ok" : "warn"}>
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </td>
                    <td className="cell-date">
                      {rule.createdAt ? formatTime(rule.createdAt) : "\u2014"}
                    </td>
                    <td>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(rule.ruleId)}
                        title="Delete rule"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Fired Alert History ────────────────────────────── */}
      <div className="alerts-section">
        <h2 className="section-title">
          Fired Alerts
          <span className="section-count">{firedAlerts.length}</span>
        </h2>
        {firedAlerts.length === 0 ? (
          <div className="empty-state">No alerts have fired yet.</div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Resource</th>
                  <th>Class</th>
                  <th>Planets</th>
                  <th>Stats</th>
                  <th>Matched At</th>
                </tr>
              </thead>
              <tbody>
                {firedAlerts.map((alert, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--accent-gold)" }}>{alert.ruleName}</td>
                    <td className="cell-name">{alert.resourceName}</td>
                    <td className="cell-class">{alert.resourceClass}</td>
                    <td className="cell-planets">{alert.planets}</td>
                    <td className="cell-stat-label" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
                      {alert.stats
                        ? Object.entries(alert.stats)
                            .map(([k, v]) => `${k.toUpperCase()}:${v}`)
                            .join(" ")
                        : "\u2014"}
                    </td>
                    <td className="cell-date">{formatTime(alert.matchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
