import { useState, useEffect, useCallback, useMemo } from "react";
import { getResources, type ResourceFilters } from "../api/client";
import type { ResourceItem, StatKey } from "../api/types";
import { STAT_KEYS } from "../api/types";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Resources.css";

type SortDir = "asc" | "desc";

export default function Resources() {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [planet, setPlanet] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [stat, setStat] = useState("");
  const [min, setMin] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<string>("oq");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  // Extract unique planets for dropdown
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

  // Sort resources
  const sorted = useMemo(() => {
    const mult = sortDir === "asc" ? 1 : -1;
    return [...resources].sort((a, b) => {
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
  }, [resources, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(STAT_KEYS.includes(key as StatKey) ? "desc" : "asc");
    }
  }

  function statClass(val: number | undefined): string {
    if (val === undefined) return "stat-empty";
    if (val >= 900) return "stat-top";
    if (val >= 667) return "stat-high";
    if (val >= 334) return "stat-mid";
    return "stat-low";
  }

  function sortIndicator(key: string): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  return (
    <div className="resources-page">
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
          <label>Class</label>
          <input
            type="text"
            placeholder="Search class..."
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          />
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
          <span className="count-value">{resources.length}</span> resources
        </div>
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
                <tr key={`${r.resourceId}-${r.planet}`}>
                  <td className="cell-name">{r.resourceName}</td>
                  <td className="cell-class">{r.resourceClass}</td>
                  <td className="cell-planets" title={r.allPlanets || r.planet}>
                    {r.allPlanets || r.planet}
                  </td>
                  {STAT_KEYS.map((s) => {
                    const val = r[s];
                    return (
                      <td key={s} className={`cell-stat ${statClass(val)}`}>
                        {val ?? "\u2014"}
                      </td>
                    );
                  })}
                  <td className="cell-reporter">{r.availableBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
