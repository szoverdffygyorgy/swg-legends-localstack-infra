import { useState, useEffect, useCallback, useMemo } from "react";
import { getResources, getClassTree, type ResourceFilters } from "../api/client";
import type { ResourceItem, ClassTreeNode, StatKey } from "../api/types";
import { STAT_KEYS } from "../api/types";
import ClassTreePicker from "../components/ClassTreePicker";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Resources.css";

type SortDir = "asc" | "desc";

// ─── Stat quality helpers ────────────────────────────────────────────

/**
 * Calculate stat quality as a percentage of the class's stat cap range.
 * Returns 0-100, or null if caps are unavailable.
 */
function statQuality(
  value: number | undefined,
  caps: [number, number] | undefined
): number | null {
  if (value === undefined || !caps) return null;
  const [min, max] = caps;
  if (max === min) return value >= max ? 100 : 0;
  return Math.round(((value - min) / (max - min)) * 100);
}

/**
 * CSS class for stat quality tier (applied to the percentage).
 * Top: >= 95%, High: 90-94%, Fair: 80-89%, Mid: 50-79%, Low: < 50%
 */
function qualityClass(quality: number | null): string {
  if (quality === null) return "qual-mid"; // fallback if no caps
  if (quality >= 95) return "qual-top";
  if (quality >= 90) return "qual-high";
  if (quality >= 80) return "qual-fair";
  if (quality >= 50) return "qual-mid";
  return "qual-low";
}

/**
 * CSS class for raw stat value (applied to the number).
 * 950-1000: top, 900-949: high, 800-899: fair, 500-799: mid, 0-499: low
 */
function rawValueClass(val: number): string {
  if (val >= 950) return "raw-top";
  if (val >= 900) return "raw-high";
  if (val >= 800) return "raw-fair";
  if (val >= 500) return "raw-mid";
  return "raw-low";
}

// ─── Component ───────────────────────────────────────────────────────

export default function Resources() {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [classTree, setClassTree] = useState<ClassTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [planet, setPlanet] = useState("");
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [stat, setStat] = useState("");
  const [min, setMin] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<string>("oq");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Load class tree on mount
  useEffect(() => {
    getClassTree()
      .then(setClassTree)
      .catch((err) => console.warn("Failed to load class tree:", err));
  }, []);

  // Build stat caps lookup: className -> { statKey -> [min, max] }
  const statCapsMap = useMemo(() => {
    const map = new Map<string, Partial<Record<StatKey, [number, number]>>>();
    for (const node of classTree) {
      if (node.isLeaf && node.statCaps) {
        map.set(node.className, node.statCaps as Partial<Record<StatKey, [number, number]>>);
      }
    }
    return map;
  }, [classTree]);

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

  // Extract unique planets for dropdown (use raw resources for full planet coverage)
  const planets = useMemo(() => {
    const set = new Set<string>();
    resources.forEach((r) => {
      if (r.allPlanets) {
        r.allPlanets.split(", ").forEach((p) => set.add(p));
      } else {
        set.add(r.planet);
      }
    });
    return [...set].sort();
  }, [resources]);

  // Deduplicate resources by resourceId.
  // The API returns one item per resource-planet combination (denormalized).
  // For display, we want one row per unique resource. Each item already has
  // allPlanets (comma-separated) so we just take the first item per resourceId.
  const deduped = useMemo(() => {
    const seen = new Map<string, ResourceItem>();
    for (const r of resources) {
      if (!seen.has(r.resourceId)) {
        seen.set(r.resourceId, r);
      }
    }
    return [...seen.values()];
  }, [resources]);

  // Sort deduplicated resources
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

  /**
   * Render a stat cell with independently colored raw value and quality %.
   * Raw value: colored by absolute thresholds (950/900/800/500).
   * Quality %: colored by cap-relative quality (95/90/80/50).
   */
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
          onSelect={setClassFilter}
        />
      </aside>

      {/* Main content */}
      <div className="resources-main">
        {/* Filter bar */}
        <div className="filter-bar">
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
