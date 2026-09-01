import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getAlertRules,
  createAlertRule,
  deleteAlertRule,
  getAlertHistory,
  getClassTree,
} from "../api/client";
import type { AlertRule, FiredAlert, ClassTreeNode } from "../api/types";
import { STAT_KEYS } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Alerts.css";

// ─── Constants ───────────────────────────────────────────────────────

const SWG_PLANETS = [
  "Corellia", "Dantooine", "Dathomir", "Endor", "Kashyyyk",
  "Lok", "Mustafar", "Naboo", "Rori", "Talus", "Tatooine", "Yavin IV",
];

// ─── Helper: normalize thresholds from API response ──────────────────

function getThresholds(rule: AlertRule): Record<string, number> {
  if (rule.statThresholds && Object.keys(rule.statThresholds).length > 0) return rule.statThresholds;
  if (rule.stat && rule.minValue !== undefined) return { [rule.stat]: rule.minValue };
  return {};
}

function formatThresholds(thresholds: Record<string, number>): string {
  const entries = Object.entries(thresholds);
  if (entries.length === 0) return "\u2014";
  return entries.map(([k, v]) => `${k.toUpperCase()} >= ${v}`).join(", ");
}

function formatPlanets(planets?: string[]): string {
  if (!planets || planets.length === 0) return "All";
  return planets.join(", ");
}

// ─── Helper: build hierarchy breadcrumb for typeahead ────────────────

function buildBreadcrumb(node: ClassTreeNode, nodeMap: Map<number, ClassTreeNode>): string {
  const parts: string[] = [];
  let current: ClassTreeNode | undefined = node;
  while (current && current.parentNodeId !== 0) {
    current = nodeMap.get(current.parentNodeId);
    if (current) parts.unshift(current.className);
  }
  return parts.length > 0 ? parts.join(" > ") : "";
}

// ─── Component ───────────────────────────────────────────────────────

export default function Alerts() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [firedAlerts, setFiredAlerts] = useState<FiredAlert[]>([]);
  const [classTree, setClassTree] = useState<ClassTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [formName, setFormName] = useState("");
  const [formClass, setFormClass] = useState("");
  const [formThresholds, setFormThresholds] = useState<{ stat: string; min: string }[]>([]);
  const [formPlanets, setFormPlanets] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Typeahead state
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState("");
  const typeaheadRef = useRef<HTMLDivElement>(null);

  // Load class tree on mount
  useEffect(() => {
    getClassTree()
      .then(setClassTree)
      .catch((err) => console.warn("Failed to load class tree:", err));
  }, []);

  // Build node map for breadcrumbs
  const nodeMap = useMemo(() => {
    const map = new Map<number, ClassTreeNode>();
    for (const node of classTree) {
      map.set(node.nodeId, node);
    }
    return map;
  }, [classTree]);

  // Typeahead filtered results
  const typeaheadResults = useMemo(() => {
    if (!typeaheadQuery.trim()) return [];
    const query = typeaheadQuery.toLowerCase();
    return classTree
      .filter((n) => n.className.toLowerCase().includes(query))
      .slice(0, 20); // limit results
  }, [typeaheadQuery, classTree]);

  // Close typeahead on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (typeaheadRef.current && !typeaheadRef.current.contains(e.target as Node)) {
        setTypeaheadOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

  // ─── Form handlers ────────────────────────────────────────────────

  function addThreshold() {
    setFormThresholds((prev) => [...prev, { stat: "", min: "" }]);
  }

  function removeThreshold(index: number) {
    setFormThresholds((prev) => prev.filter((_, i) => i !== index));
  }

  function updateThreshold(index: number, field: "stat" | "min", value: string) {
    setFormThresholds((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function addPlanet() {
    // Find the first planet not already selected
    const available = SWG_PLANETS.filter((p) => !formPlanets.includes(p));
    if (available.length > 0) {
      setFormPlanets((prev) => [...prev, available[0]]);
    }
  }

  function removePlanet(index: number) {
    setFormPlanets((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePlanet(index: number, value: string) {
    setFormPlanets((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function selectTypeahead(className: string) {
    setFormClass(className);
    setTypeaheadQuery("");
    setTypeaheadOpen(false);
  }

  // Stats already used in thresholds (exclude from dropdowns)
  const usedStats = new Set(formThresholds.map((t) => t.stat).filter(Boolean));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      // Build statThresholds map
      const statThresholds: Record<string, number> = {};
      for (const t of formThresholds) {
        if (t.stat && t.min) {
          statThresholds[t.stat] = Number(t.min);
        }
      }

      const body: Parameters<typeof createAlertRule>[0] = {
        name: formName,
        classPattern: formClass,
      };

      if (Object.keys(statThresholds).length > 0) {
        body.statThresholds = statThresholds;
      }
      if (formPlanets.length > 0) {
        body.planets = formPlanets;
      }

      await createAlertRule(body);

      // Reset form
      setFormName("");
      setFormClass("");
      setFormThresholds([]);
      setFormPlanets([]);
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
          {/* Name + Class row */}
          <div className="form-row">
            <div className="form-group form-group--wide">
              <label>Name *</label>
              <input
                type="text"
                placeholder='e.g., "Endgame Metal"'
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
            <div className="form-group form-group--wide" ref={typeaheadRef}>
              <label>Class * (hierarchy-aware)</label>
              <input
                type="text"
                placeholder='e.g., "Metal", "Copper", "Desh Copper"'
                value={typeaheadOpen ? typeaheadQuery : formClass}
                onChange={(e) => {
                  setTypeaheadQuery(e.target.value);
                  setTypeaheadOpen(true);
                  if (!e.target.value) setFormClass("");
                }}
                onFocus={() => {
                  setTypeaheadQuery(formClass);
                  setTypeaheadOpen(true);
                }}
                required
              />
              {typeaheadOpen && typeaheadResults.length > 0 && (
                <div className="typeahead-dropdown">
                  {typeaheadResults.map((node) => (
                    <div
                      key={node.nodeId}
                      className={`typeahead-item ${node.isLeaf ? "typeahead-item--leaf" : "typeahead-item--branch"}`}
                      onClick={() => selectTypeahead(node.className)}
                    >
                      <span className="typeahead-name">{node.className}</span>
                      <span className="typeahead-breadcrumb">
                        {buildBreadcrumb(node, nodeMap)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Stat thresholds section */}
          <div className="form-section">
            <label className="form-section-label">Stat Thresholds (all must be met)</label>
            {formThresholds.map((t, i) => (
              <div key={i} className="threshold-row">
                <select
                  value={t.stat}
                  onChange={(e) => updateThreshold(i, "stat", e.target.value)}
                >
                  <option value="">Select stat...</option>
                  {STAT_KEYS.map((s) => (
                    <option key={s} value={s} disabled={usedStats.has(s) && t.stat !== s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
                <span className="threshold-operator">{">="}</span>
                <input
                  type="number"
                  placeholder="0"
                  min="0"
                  max="1000"
                  value={t.min}
                  onChange={(e) => updateThreshold(i, "min", e.target.value)}
                />
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => removeThreshold(i)}
                  title="Remove threshold"
                >
                  x
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-add"
              onClick={addThreshold}
              disabled={formThresholds.length >= STAT_KEYS.length}
            >
              + Add threshold
            </button>
          </div>

          {/* Planets section */}
          <div className="form-section">
            <label className="form-section-label">Planets (match any listed)</label>
            {formPlanets.map((p, i) => (
              <div key={i} className="planet-row">
                <select
                  value={p}
                  onChange={(e) => updatePlanet(i, e.target.value)}
                >
                  {SWG_PLANETS.map((planet) => (
                    <option
                      key={planet}
                      value={planet}
                      disabled={formPlanets.includes(planet) && p !== planet}
                    >
                      {planet}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => removePlanet(i)}
                  title="Remove planet"
                >
                  x
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-add"
              onClick={addPlanet}
              disabled={formPlanets.length >= SWG_PLANETS.length}
            >
              + Add planet
            </button>
          </div>

          {/* Submit */}
          <div className="form-actions">
            <button type="submit" className="btn-create" disabled={creating}>
              {creating ? "Creating..." : "Create Rule"}
            </button>
            {createError && <span className="form-error">{createError}</span>}
          </div>
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
                  <th>Class</th>
                  <th>Stat Thresholds</th>
                  <th>Planets</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const thresholds = getThresholds(rule);
                  return (
                    <tr key={rule.ruleId}>
                      <td className="cell-name">{rule.name}</td>
                      <td className="cell-class-pattern">{rule.classPattern}</td>
                      <td className="cell-thresholds">
                        {formatThresholds(thresholds)}
                      </td>
                      <td className="cell-planets">
                        {formatPlanets(rule.planets)}
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
                  );
                })}
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
