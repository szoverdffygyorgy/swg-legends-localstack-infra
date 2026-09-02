import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useResource, useHistoryResource, useClassTree, useSchematicsByClass } from "../api/hooks";
import type { ClassTreeNode, SchematicSummary, StatKey } from "../api/types";
import { STAT_KEYS } from "../api/types";
import {
  computeOverallScore,
  scoreTierClass,
  type FlatStats,
} from "../utils/scoring";
import StatBar from "../components/StatBar";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "../components/StatBar.css";
import "./ResourceProfile.css";

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatIsoDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Build the full classification breadcrumb from the class tree.
 * e.g., "Inorganic / Mineral / Metal / Non-Ferrous Metal / Copper / Desh Copper"
 */
function buildClassBreadcrumb(
  className: string,
  classTree: ClassTreeNode[]
): string[] {
  const node = classTree.find((n) => n.className === className);
  if (!node || !node.path) return [className];

  // Walk up the tree path to build the breadcrumb
  const segments = node.path.split("/");
  const breadcrumb: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const partialPath = segments.slice(0, i + 1).join("/");
    const match = classTree.find((n) => n.path === partialPath);
    if (match) {
      breadcrumb.push(match.className);
    }
  }

  return breadcrumb.length > 0 ? breadcrumb : [className];
}

export default function ResourceProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showLowScores, setShowLowScores] = useState(false);
  const [showPrecu, setShowPrecu] = useState(false);

  const activeQuery = useResource(id ?? "");
  const historyQuery = useHistoryResource(id ?? "");
  const classTreeQuery = useClassTree();

  const active = activeQuery.data ?? null;
  const history = historyQuery.data ?? null;
  const classTree = classTreeQuery.data ?? [];

  // Still loading if either resource query is in initial load and hasn't errored
  const loading =
    (activeQuery.isLoading || historyQuery.isLoading) && !active && !history;

  // Error only if BOTH queries failed (either could 404 legitimately)
  const bothFailed = activeQuery.isError && historyQuery.isError;
  const errorMessage = bothFailed
    ? (activeQuery.error instanceof Error ? activeQuery.error.message : "Failed to load resource")
    : null;

  // Derive the display data from whichever source is available (prefer active)
  const resource = useMemo(() => {
    if (!active && !history) return null;

    const source = active ?? history!;
    return {
      resourceId: source.resourceId,
      resourceName: source.resourceName,
      resourceClass: source.resourceClass,
      resourceClassId: source.resourceClassId,
      planets: source.planets,
      stats: source.stats,
      classPath: source.classPath,
      classCategory: source.classCategory,
      classGroup: source.classGroup,
      availableTimestamp: source.availableTimestamp,
      availableBy: source.availableBy,
      isActive: active !== null,
      despawnedAt: history?.despawnedAt ?? null,
    };
  }, [active, history]);

  // Look up stat caps for this resource's class
  const statCaps = useMemo(() => {
    if (!resource) return null;
    const node = classTree.find(
      (n) => n.isLeaf && n.className === resource.resourceClass
    );
    return node?.statCaps ?? null;
  }, [resource, classTree]);

  // Build classification breadcrumb
  const breadcrumb = useMemo(() => {
    if (!resource) return [];
    return buildClassBreadcrumb(resource.resourceClass, classTree);
  }, [resource, classTree]);

  // Get stats that have both a value and caps (for bar display)
  const statsWithCaps = useMemo(() => {
    if (!resource || !statCaps) return [];
    return STAT_KEYS
      .filter((key) => resource.stats[key] !== undefined && statCaps[key])
      .map((key) => ({
        key,
        value: resource.stats[key],
        capMin: statCaps[key]![0],
        capMax: statCaps[key]![1],
      }));
  }, [resource, statCaps]);

  // Stats without caps (displayed as plain values)
  const statsWithoutCaps = useMemo(() => {
    if (!resource) return [];
    return STAT_KEYS
      .filter((key) => resource.stats[key] !== undefined && (!statCaps || !statCaps[key]))
      .map((key) => ({
        key,
        value: resource.stats[key],
      }));
  }, [resource, statCaps]);

  // Fetch schematics that use this resource's class (hierarchy-aware)
  const schematicsQuery = useSchematicsByClass(resource?.resourceClass ?? "");
  const schematics = schematicsQuery.data ?? [];

  // Build flat stats for scoring
  const flatStats: FlatStats = useMemo(() => {
    if (!resource) return {};
    const stats: FlatStats = {};
    for (const [k, v] of Object.entries(resource.stats)) {
      stats[k as StatKey] = v;
    }
    return stats;
  }, [resource]);

  // Group schematics by the matched class, compute scores, sort by score descending
  const schematicsByClass = useMemo(() => {
    const groups = new Map<string, ScoredSchematic[]>();
    for (const s of schematics) {
      const cls = s.matchedClass ?? "Unknown";
      if (!groups.has(cls)) groups.set(cls, []);

      const expGroups = s.experimentalGroups ?? [];
      const isLq = s.quality === "lq";
      const hasExperimental = expGroups.length > 0;
      const score = hasExperimental && !isLq
        ? computeOverallScore(flatStats, expGroups)
        : null;

      groups.get(cls)!.push({
        ...s,
        score,
        isLq,
        hasExperimental,
      });
    }

    // Sort within each group: scored items by score desc, then lq/no-exp at bottom
    for (const [, items] of groups) {
      items.sort((a, b) => {
        if (a.score !== null && b.score !== null) return b.score - a.score;
        if (a.score !== null) return -1;
        if (b.score !== null) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    // Sort groups: exact class first, then by hierarchy depth (most specific first)
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === resource?.resourceClass) return -1;
      if (b[0] === resource?.resourceClass) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [schematics, resource, flatStats]);

  // Total filtered schematic count for the section header
  const filteredSchematicCount = useMemo(() => {
    return schematics.filter((s) => {
      if (!showPrecu && s.base === "precu") return false;
      // For the header count, we include low-score items regardless of toggle
      // since the toggle only affects visibility within groups
      return true;
    }).length;
  }, [schematics, showPrecu]);

  if (loading) {
    return (
      <div className="profile-page">
        <LoadingSpinner message="Loading resource..." />
      </div>
    );
  }

  if (errorMessage || !resource) {
    return (
      <div className="profile-page">
        <ErrorMessage
          message={errorMessage ?? "Resource not found"}
          onRetry={() => {
            activeQuery.refetch();
            historyQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="profile-page">
      {/* Back button */}
      <button className="profile-back" onClick={() => navigate(-1)}>
        &larr; Back
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-title-row">
          <h1 className="profile-name">{resource.resourceName}</h1>
          <StatusBadge variant={resource.isActive ? "ok" : "despawned"}>
            {resource.isActive ? "Available" : "Despawned"}
          </StatusBadge>
        </div>

        {/* Classification breadcrumb */}
        <div className="profile-breadcrumb">
          {breadcrumb.map((segment, i) => (
            <span key={i}>
              {i > 0 && <span className="breadcrumb-sep"> / </span>}
              <span className={i === breadcrumb.length - 1 ? "breadcrumb-leaf" : "breadcrumb-node"}>
                {segment}
              </span>
            </span>
          ))}
        </div>

        {/* Meta info */}
        <div className="profile-meta">
          <div className="meta-item">
            <span className="meta-label">Planets</span>
            <div className="meta-planets">
              {resource.planets.map((p) => (
                <span key={p} className="planet-chip">{p}</span>
              ))}
            </div>
          </div>
          <div className="meta-item">
            <span className="meta-label">Spawned</span>
            <span className="meta-value">{formatDate(resource.availableTimestamp)}</span>
          </div>
          {resource.despawnedAt && (
            <div className="meta-item">
              <span className="meta-label">Despawned</span>
              <span className="meta-value">{formatIsoDate(resource.despawnedAt)}</span>
            </div>
          )}
          <div className="meta-item">
            <span className="meta-label">Reporter</span>
            <span className="meta-value">{resource.availableBy}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">ID</span>
            <span className="meta-value meta-id">{resource.resourceId}</span>
          </div>
        </div>
      </div>

      {/* Stats section */}
      <div className="profile-section">
        <h2 className="section-title">Stats</h2>
        {statsWithCaps.length > 0 && (
          <div className="profile-stats">
            {statsWithCaps.map(({ key, value, capMin, capMax }) => (
              <StatBar
                key={key}
                statKey={key}
                value={value}
                capMin={capMin}
                capMax={capMax}
              />
            ))}
          </div>
        )}
        {statsWithoutCaps.length > 0 && (
          <div className="profile-stats-plain">
            {statsWithoutCaps.map(({ key, value }) => (
              <div key={key} className="stat-plain-row">
                <span className="stat-plain-label">{key.toUpperCase()}</span>
                <span className="stat-plain-value">{value}</span>
              </div>
            ))}
          </div>
        )}
        {statsWithCaps.length === 0 && statsWithoutCaps.length === 0 && (
          <p className="profile-empty">No stat data available.</p>
        )}
      </div>

      {/* Used In Schematics section */}
      <div className="profile-section">
        <h2 className="section-title">
          Used In Schematics
          {schematics.length > 0 && (
            <span className="schematics-count">{filteredSchematicCount}</span>
          )}
        </h2>
        {schematicsQuery.isLoading && (
          <p className="profile-empty">Loading schematics...</p>
        )}
        {!schematicsQuery.isLoading && schematics.length === 0 && (
          <p className="profile-empty">No schematics use this resource class.</p>
        )}
        {!schematicsQuery.isLoading && schematics.length > 0 && (
          <div className="schematics-controls">
            <label className="schematics-toggle">
              <input
                type="checkbox"
                checked={showLowScores}
                onChange={(e) => setShowLowScores(e.target.checked)}
              />
              Show low scores (&lt; 500)
            </label>
            <label className="schematics-toggle">
              <input
                type="checkbox"
                checked={showPrecu}
                onChange={(e) => setShowPrecu(e.target.checked)}
              />
              Show preCU schematics
            </label>
          </div>
        )}
        {schematicsByClass.map(([className, items]) => {
          const isExpanded = expandedGroups.has(className);
          const visible = items.filter((s) => {
            if (!showPrecu && s.base === "precu") return false;
            if (!showLowScores && s.score !== null && s.score < 500) return false;
            return true;
          });
          const hidden = items.length - visible.length;

          if (visible.length === 0 && !isExpanded) return null;

          return (
            <div key={className} className="schematics-group">
              <button
                className="schematics-group-header schematics-group-header--toggle"
                onClick={() => {
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(className)) next.delete(className);
                    else next.add(className);
                    return next;
                  });
                }}
              >
                <span className="schematics-group-arrow">
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
                <span className="schematics-group-label">as</span>
                <span className="schematics-group-class">{className}</span>
                <span className="schematics-group-count">{visible.length}</span>
                {hidden > 0 && (
                  <span className="schematics-group-hidden">{hidden} hidden</span>
                )}
              </button>
              {isExpanded && (
                <SchematicsTable items={visible} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────

interface ScoredSchematic extends SchematicSummary {
  score: number | null;
  isLq: boolean;
  hasExperimental: boolean;
}

// ─── Schematics Table (list rows per group) ──────────────────────────

function SchematicsTable({ items }: { items: ScoredSchematic[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayCount = showAll ? items.length : 20;
  const shown = items.slice(0, displayCount);
  const remaining = items.length - 20;

  if (items.length === 0) {
    return <p className="profile-empty">All schematics hidden (below score threshold).</p>;
  }

  return (
    <div className="schematics-table">
      <div className="schematics-table-header">
        <span className="schem-col schem-col--name">Schematic</span>
        <span className="schem-col schem-col--base">Base</span>
        <span className="schem-col schem-col--score">Score</span>
      </div>
      {shown.map((s) => (
        <Link
          key={s.schematicId}
          to={`/schematics/${s.schematicId}`}
          className={`schematics-table-row ${s.isLq ? "schematics-table-row--lq" : ""}`}
        >
          <span className="schem-col schem-col--name">{s.name}</span>
          <span className={`schem-col schem-col--base schematic-base schematic-base--${s.base}`}>
            {s.base}
          </span>
          <span className="schem-col schem-col--score">
            {s.isLq ? (
              <span className="schem-score-lq">lq</span>
            ) : s.score !== null ? (
              <span className={`schem-score ${scoreTierClass(s.score)}`}>{s.score}</span>
            ) : (
              <span className="schem-score-na">--</span>
            )}
          </span>
        </Link>
      ))}
      {remaining > 0 && !showAll && (
        <button className="schematics-show-all" onClick={() => setShowAll(true)}>
          Show all {items.length} schematics
        </button>
      )}
      {showAll && remaining > 0 && (
        <button className="schematics-show-all" onClick={() => setShowAll(false)}>
          Show less
        </button>
      )}
    </div>
  );
}
