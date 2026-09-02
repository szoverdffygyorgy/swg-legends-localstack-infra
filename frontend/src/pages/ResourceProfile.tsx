import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useResource, useHistoryResource, useClassTree } from "../api/hooks";
import type { ClassTreeNode } from "../api/types";
import { STAT_KEYS } from "../api/types";
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
    </div>
  );
}
