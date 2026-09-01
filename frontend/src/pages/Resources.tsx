import { useState, useEffect, useCallback, useMemo } from "react";
import { getResources, getClassTree, getAlertRules, type ResourceFilters } from "../api/client";
import type { ResourceItem, ClassTreeNode, AlertRule, StatKey } from "../api/types";
import { STAT_KEYS } from "../api/types";
import ClassTreePicker from "../components/ClassTreePicker";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Resources.css";

type SortDir = "asc" | "desc";

// ─── Stat quality helpers ────────────────────────────────────────────

function statQuality(
  value: number | undefined,
  caps: [number, number] | undefined
): number | null {
  if (value === undefined || !caps) return null;
  const [min, max] = caps;
  if (max === min) return value >= max ? 100 : 0;
  return Math.round(((value - min) / (max - min)) * 100);
}

function qualityClass(quality: number | null): string {
  if (quality === null) return "qual-mid";
  if (quality >= 95) return "qual-top";
  if (quality >= 90) return "qual-high";
  if (quality >= 80) return "qual-fair";
  if (quality >= 50) return "qual-mid";
  return "qual-low";
}

function rawValueClass(val: number): string {
  if (val >= 950) return "raw-top";
  if (val >= 900) return "raw-high";
  if (val >= 800) return "raw-fair";
  if (val >= 500) return "raw-mid";
  return "raw-low";
}

// ─── Alert helpers ───────────────────────────────────────────────────

/** Get normalized stat thresholds from an alert rule (handles legacy format). */
function getAlertThresholds(rule: AlertRule): Record<string, number> {
  if (rule.statThresholds && Object.keys(rule.statThresholds).length > 0) return rule.statThresholds;
  if (rule.stat && rule.minValue !== undefined) return { [rule.stat]: rule.minValue };
  return {};
}

/** Format an alert rule for the dropdown display. */
function formatAlertLabel(rule: AlertRule): string {
  const parts: string[] = [rule.name, `(${rule.classPattern}`];

  const thresholds = getAlertThresholds(rule);
  const statParts = Object.entries(thresholds).map(([k, v]) => `${k.toUpperCase()}>=${v}`);
  if (statParts.length > 0) parts.push(`, ${statParts.join(", ")}`);

  const planets = rule.planets ?? [];
  if (planets.length > 0) parts.push(` | ${planets.join(", ")}`);

  parts.push(")");
  return parts.join("");
}

/** Check if a resource matches an alert's stat thresholds and planet filter. */
function resourceMatchesAlert(r: ResourceItem, rule: AlertRule): boolean {
  // Check stat thresholds (AND)
  const thresholds = getAlertThresholds(rule);
  for (const [stat, minVal] of Object.entries(thresholds)) {
    const val = r[stat as StatKey];
    if (val === undefined || val < minVal) return false;
  }

  // Check planet filter (OR)
  const planets = rule.planets ?? [];
  if (planets.length > 0) {
    const resourcePlanets = r.allPlanets ? r.allPlanets.split(", ") : [r.planet];
    const rulePlanets = new Set(planets);
    if (!resourcePlanets.some((p) => rulePlanets.has(p))) return false;
  }

  return true;
}

// ─── Component ───────────────────────────────────────────────────────

export default function Resources() {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [classTree, setClassTree] = useState<ClassTreeNode[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [planet, setPlanet] = useState("");
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [stat, setStat] = useState("");
  const [min, setMin] = useState("");

  // Alert filter
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  // Sort
  const [sortKey, setSortKey] = useState<string>("oq");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Load class tree and alert rules on mount
  useEffect(() => {
    getClassTree()
      .then(setClassTree)
      .catch((err) => console.warn("Failed to load class tree:", err));
    getAlertRules()
      .then((data) => setAlertRules(data.rules))
      .catch((err) => console.warn("Failed to load alert rules:", err));
  }, []);

  // Build stat caps lookup
  const statCapsMap = useMemo(() => {
    const map = new Map<string, Partial<Record<StatKey, [number, number]>>>();
    for (const node of classTree) {
      if (node.isLeaf && node.statCaps) {
        map.set(node.className, node.statCaps as Partial<Record<StatKey, [number, number]>>);
      }
    }
    return map;
  }, [classTree]);

  // Resolve selected alert rule object
  const selectedAlert = useMemo(() => {
    if (!selectedAlertId) return null;
    return alertRules.find((r) => r.ruleId === selectedAlertId) ?? null;
  }, [selectedAlertId, alertRules]);

  // When alert selection changes, update the class filter to match
  const handleAlertChange = useCallback((alertId: string) => {
    if (!alertId) {
      setSelectedAlertId(null);
      setClassFilter(null);
      return;
    }
    const rule = alertRules.find((r) => r.ruleId === alertId);
    if (rule) {
      setSelectedAlertId(alertId);
      setClassFilter(rule.classPattern);
    }
  }, [alertRules]);

  // When class tree is clicked directly, clear the alert selection
  const handleClassSelect = useCallback((className: string | null) => {
    setClassFilter(className);
    setSelectedAlertId(null); // manual class selection overrides alert
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: ResourceFilters = {};
      if (planet) filters.planet = planet;
      if (classFilter) filters.class = classFilter;
      if (stat && min) {
        filters.stat = stat;
        filters.min = Number(min);
      }
      const data = await getResources(filters);
      setResources(data.resources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [planet, classFilter, stat, min]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Pipeline: raw resources -> alert post-filter -> planet extraction -> dedup -> sort

  // Step 1: Apply alert's stat thresholds and planet filter (if an alert is active)
  const alertFiltered = useMemo(() => {
    if (!selectedAlert) return resources;
    return resources.filter((r) => resourceMatchesAlert(r, selectedAlert));
  }, [resources, selectedAlert]);

  // Step 2: Extract unique planets for dropdown (from the alert-filtered set)
  const planets = useMemo(() => {
    const set = new Set<string>();
    alertFiltered.forEach((r) => {
      if (r.allPlanets) {
        r.allPlanets.split(", ").forEach((p) => set.add(p));
      } else {
        set.add(r.planet);
      }
    });
    return [...set].sort();
  }, [alertFiltered]);

  // Step 3: Deduplicate by resourceId
  const deduped = useMemo(() => {
    const seen = new Map<string, ResourceItem>();
    for (const r of alertFiltered) {
      if (!seen.has(r.resourceId)) {
        seen.set(r.resourceId, r);
      }
    }
    return [...seen.values()];
  }, [alertFiltered]);

  // Step 4: Sort
  const sorted = useMemo(() => {
    const mult = sortDir === "asc" ? 1 : -1;
    return [...deduped].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey];
      const bVal = (b as unknown as Record<string, unknown>)[sortKey];

      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return aVal.localeCompare(bVal) * mult;
      }
      return ((aVal as number) - (bVal as number)) * mult;
    });
  }, [deduped, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(STAT_KEYS.includes(key as StatKey) ? "desc" : "asc");
    }
  }

  function sortIndicator(key: string): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  function renderStatCell(r: ResourceItem, statKey: StatKey) {
    const val = r[statKey];
    if (val === undefined) {
      return (
        <td key={statKey} className="cell-stat stat-empty">
          {"\u2014"}
        </td>
      );
    }

    const caps = statCapsMap.get(r.resourceClass);
    const capRange = caps?.[statKey];
    const quality = statQuality(val, capRange);
    const rClass = rawValueClass(val);
    const qClass = qualityClass(quality);

    const tooltip = capRange
      ? `${statKey.toUpperCase()}: ${val} / cap ${capRange[0]}-${capRange[1]}`
      : `${statKey.toUpperCase()}: ${val}`;

    return (
      <td key={statKey} className="cell-stat" title={tooltip}>
        <span className={`stat-value ${rClass}`}>{val}</span>
        {quality !== null && (
          <span className={`stat-quality ${qClass}`}> ({quality}%)</span>
        )}
      </td>
    );
  }

  return (
    <div className="resources-page">
      {/* Sidebar: Class tree */}
      <aside className="resources-sidebar">
        <ClassTreePicker
          tree={classTree}
          selected={classFilter}
          onSelect={handleClassSelect}
        />
      </aside>

      {/* Main content */}
      <div className="resources-main">
        {/* Filter bar */}
        <div className="filter-bar">
          <div className="filter-group filter-group--alert">
            <label>Alert</label>
            <select
              value={selectedAlertId ?? ""}
              onChange={(e) => handleAlertChange(e.target.value)}
              className={selectedAlertId ? "alert-active" : ""}
            >
              <option value="">No Alert</option>
              {alertRules.map((rule) => (
                <option key={rule.ruleId} value={rule.ruleId}>
                  {formatAlertLabel(rule)}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Planet</label>
            <select value={planet} onChange={(e) => setPlanet(e.target.value)}>
              <option value="">All Planets</option>
              {planets.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Stat</label>
            <select value={stat} onChange={(e) => setStat(e.target.value)}>
              <option value="">Any</option>
              {STAT_KEYS.map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Min</label>
            <input
              type="number"
              placeholder="0"
              min="0"
              max="1000"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              disabled={!stat}
            />
          </div>
          <div className="filter-count">
            <span className="count-value">{deduped.length}</span> resources
          </div>
        </div>

        {/* Stat color legend */}
        <div className="stat-legend">
          <span className="legend-section">
            <span className="legend-label">Value:</span>
            <span className="raw-top">950+</span>
            <span className="raw-high">900+</span>
            <span className="raw-fair">800+</span>
            <span className="raw-mid">500+</span>
            <span className="raw-low">&lt;500</span>
          </span>
          <span className="legend-divider" />
          <span className="legend-section">
            <span className="legend-label">Quality:</span>
            <span className="qual-top">95%+</span>
            <span className="qual-high">90%+</span>
            <span className="qual-fair">80%+</span>
            <span className="qual-mid">50%+</span>
            <span className="qual-low">&lt;50%</span>
          </span>
        </div>

        {/* Content */}
        {loading && <LoadingSpinner message="Querying resources..." />}
        {error && <ErrorMessage message={error} onRetry={fetchData} />}
        {!loading && !error && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort("resourceName")} className="sortable">
                    Name{sortIndicator("resourceName")}
                  </th>
                  <th onClick={() => handleSort("resourceClass")} className="sortable">
                    Class{sortIndicator("resourceClass")}
                  </th>
                  <th onClick={() => handleSort("classCategory")} className="sortable">
                    Category{sortIndicator("classCategory")}
                  </th>
                  <th>Planets</th>
                  {STAT_KEYS.map((s) => (
                    <th
                      key={s}
                      onClick={() => handleSort(s)}
                      className="sortable stat-header"
                    >
                      {s.toUpperCase()}{sortIndicator(s)}
                    </th>
                  ))}
                  <th>Reporter</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.resourceId}>
                    <td className="cell-name">{r.resourceName}</td>
                    <td className="cell-class">{r.resourceClass}</td>
                    <td className="cell-category">
                      {r.classGroup && r.classCategory ? (
                        <>
                          <span className="category-label">{r.classCategory}</span>
                          <span className="group-separator">/</span>
                          <span className="group-label">{r.classGroup}</span>
                        </>
                      ) : (
                        <span className="category-label">{r.classCategory ?? "\u2014"}</span>
                      )}
                    </td>
                    <td className="cell-planets" title={r.allPlanets || r.planet}>
                      {r.allPlanets || r.planet}
                    </td>
                    {STAT_KEYS.map((s) => renderStatCell(r, s))}
                    <td className="cell-reporter">{r.availableBy}</td>
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
