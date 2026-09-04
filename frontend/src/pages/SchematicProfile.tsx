import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSchematic, useResourcesByClasses, useHistoryByClasses } from "../api/hooks";
import type {
  SchematicIngredient,
  ExperimentalGroup,
  StatKey,
} from "../api/types";

import {
  computeOverallScore,
  scoreTierClass,
  getRelevantStats,
  extractStats,
  STAT_NAMES,
  type FlatStats,
} from "../utils/scoring";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "../components/StatBar.css";
import "./ResourceProfile.css";
import "./SchematicProfile.css";

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Deduplicate resource items by resourceId (one item per planet in DynamoDB).
 */
function deduplicateResources<T extends { resourceId: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.resourceId)) {
      seen.set(item.resourceId, item);
    }
  }
  return [...seen.values()];
}

// ─── Component ───────────────────────────────────────────────────────

export default function SchematicProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const schematicQuery = useSchematic(id ?? "");
  const [showHistory, setShowHistory] = useState(false);

  const schematic = schematicQuery.data ?? null;

  // Collect unique resource class names from ingredients
  const resourceIngredients = useMemo(() => {
    if (!schematic) return [];
    return schematic.ingredients.filter(
      (ing): ing is SchematicIngredient & { className: string } =>
        ing.type === "resource" && !!ing.className
    );
  }, [schematic]);

  const uniqueClassNames = useMemo(() => {
    return [...new Set(resourceIngredients.map((ing) => ing.className))];
  }, [resourceIngredients]);

  // Relevant stats for this schematic's experimental weights
  const relevantStats = useMemo(() => {
    if (!schematic) return [];
    return getRelevantStats(schematic.experimentalGroups);
  }, [schematic]);

  // Fetch active resources for each unique ingredient class (single hook call)
  const activeResults = useResourcesByClasses(uniqueClassNames);

  // Fetch history resources for each unique ingredient class (only when toggled)
  const historyResults = useHistoryByClasses(uniqueClassNames, showHistory);

  // Build scored + sorted resource maps
  const activeByClass = useMemo(() => {
    if (!schematic) return new Map<string, ScoredResource[]>();
    const map = new Map<string, ScoredResource[]>();

    for (let i = 0; i < uniqueClassNames.length; i++) {
      const cls = uniqueClassNames[i];
      const result = activeResults[i];
      if (!result?.data) continue;
      const deduped = deduplicateResources(result.data);
      const scored = deduped.map((r) => ({
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        resourceClass: r.resourceClass,
        stats: extractStats(r as unknown as Record<string, unknown>),
        score: computeOverallScore(
          extractStats(r as unknown as Record<string, unknown>),
          schematic.experimentalGroups
        ),
        isActive: true as const,
      }));
      scored.sort((a, b) => b.score - a.score);
      map.set(cls, scored);
    }
    return map;
  }, [schematic, uniqueClassNames, activeResults]);

  const historyByClass = useMemo(() => {
    if (!schematic || !showHistory) return new Map<string, ScoredResource[]>();
    const map = new Map<string, ScoredResource[]>();

    for (let i = 0; i < uniqueClassNames.length; i++) {
      const cls = uniqueClassNames[i];
      const result = historyResults[i];
      if (!result?.data) continue;
      const deduped = deduplicateResources(result.data);
      // Filter out any that are also in the active set
      const activeIds = new Set(
        (activeByClass.get(cls) ?? []).map((r) => r.resourceId)
      );
      const historyOnly = deduped.filter((r) => !activeIds.has(r.resourceId));
      const scored = historyOnly.map((r) => ({
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        resourceClass: r.resourceClass,
        stats: extractStats(r as unknown as Record<string, unknown>),
        score: computeOverallScore(
          extractStats(r as unknown as Record<string, unknown>),
          schematic.experimentalGroups
        ),
        isActive: false as const,
      }));
      scored.sort((a, b) => b.score - a.score);
      map.set(cls, scored);
    }
    return map;
  }, [schematic, showHistory, uniqueClassNames, historyResults, activeByClass]);

  // ─── Render ──────────────────────────────────────────────────────

  if (schematicQuery.isLoading) {
    return (
      <div className="profile-page">
        <LoadingSpinner message="Loading schematic..." />
      </div>
    );
  }

  if (schematicQuery.isError || !schematic) {
    return (
      <div className="profile-page">
        <ErrorMessage
          message={
            schematicQuery.error instanceof Error
              ? schematicQuery.error.message
              : "Schematic not found"
          }
          onRetry={() => schematicQuery.refetch()}
        />
      </div>
    );
  }

  const hasExperimental = schematic.experimentalGroups.length > 0;

  return (
    <div className="profile-page">
      {/* Back button */}
      <button className="profile-back" onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/resources")}>
        &larr; Back
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-title-row">
          <h1 className="profile-name">{schematic.name}</h1>
          <StatusBadge variant={schematic.base === "nge" ? "ok" : "info"}>
            {schematic.base.toUpperCase()}
          </StatusBadge>
        </div>

        {schematic.description && (
          <p className="schem-description">{schematic.description}</p>
        )}

        {/* Meta info */}
        <div className="profile-meta">
          <div className="meta-item">
            <span className="meta-label">Profession</span>
            <span className="meta-value">{schematic.profession}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Level</span>
            <span className="meta-value">{schematic.professionLevel}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Complexity</span>
            <span className="meta-value">{schematic.complexity}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">XP</span>
            <span className="meta-value">{schematic.xp}</span>
          </div>
          {schematic.manufacture && (
            <div className="meta-item">
              <span className="meta-label">Crate Size</span>
              <span className="meta-value">{schematic.crateSize}</span>
            </div>
          )}
          <div className="meta-item">
            <span className="meta-label">Quality</span>
            <span className="meta-value">{schematic.quality}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">ID</span>
            <span className="meta-value meta-id">{schematic.schematicId}</span>
          </div>
        </div>
      </div>

      {/* Ingredients */}
      <div className="profile-section">
        <h2 className="profile-section-title">
          Ingredients
          <span className="schematics-count">{schematic.ingredients.length}</span>
        </h2>
        {schematic.ingredients.length === 0 ? (
          <p className="profile-empty">No ingredients.</p>
        ) : (
          <div className="ingredients-grid">
            {schematic.ingredients.map((ing, i) => (
              <IngredientCard key={i} ingredient={ing} />
            ))}
          </div>
        )}
      </div>

      {/* Experimental Properties */}
      {hasExperimental && (
        <div className="profile-section">
          <h2 className="profile-section-title">Experimental Properties</h2>
          <div className="exp-groups">
            {schematic.experimentalGroups.map((group, gi) => (
              <ExperimentalGroupCard key={gi} group={group} />
            ))}
          </div>
        </div>
      )}

      {/* Best Current Resources */}
      {resourceIngredients.length > 0 && hasExperimental && (
        <div className="profile-section">
          <h2 className="profile-section-title">Best Current Resources</h2>
          <p className="section-subtitle">
            Active resources ranked by weighted experimental score
          </p>
          {uniqueClassNames.map((cls, i) => (
            <ResourceSlot
              key={cls}
              className={cls}
              resources={activeByClass.get(cls) ?? []}
              loading={activeResults[i]?.isLoading ?? false}
              relevantStats={relevantStats}
              variant="active"
            />
          ))}

          {/* Historical best toggle */}
          <div className="history-toggle">
            <button
              className="history-toggle-btn"
              onClick={() => setShowHistory((prev) => !prev)}
            >
              {showHistory ? "Hide" : "Show"} Historical Best
            </button>
          </div>

          {showHistory && (
            <div className="history-section">
              <h3 className="section-subtitle history-subtitle">
                Historical Best (Despawned)
              </h3>
              {uniqueClassNames.map((cls, i) => (
                  <ResourceSlot
                    key={cls}
                    className={cls}
                    resources={historyByClass.get(cls) ?? []}
                    loading={historyResults[i]?.isLoading ?? false}
                    relevantStats={relevantStats}
                    variant="history"
                  />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scored resource type ────────────────────────────────────────────

interface ScoredResource {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  stats: FlatStats;
  score: number;
  isActive: boolean;
}

// ─── Ingredient Card ─────────────────────────────────────────────────

function IngredientCard({ ingredient }: { ingredient: SchematicIngredient }) {
  const isResource = ingredient.type === "resource";

  return (
    <div className={`ingredient-card ingredient-card--${ingredient.type}`}>
      <div className="ingredient-type-badge">
        {isResource ? "Resource" : "Component"}
      </div>
      <div className="ingredient-desc">{ingredient.desc}</div>
      {isResource && ingredient.className && (
        <div className="ingredient-class">{ingredient.className}</div>
      )}
      {isResource && ingredient.units && (
        <div className="ingredient-units">{ingredient.units} units</div>
      )}
      {!isResource && ingredient.count && (
        <div className="ingredient-units">{ingredient.count}x</div>
      )}
      {ingredient.optional && (
        <span className="ingredient-optional">optional</span>
      )}
    </div>
  );
}

// ─── Experimental Group Card ─────────────────────────────────────────

function ExperimentalGroupCard({ group }: { group: ExperimentalGroup }) {
  return (
    <div className="exp-group-card">
      <div className="exp-group-name">{group.group}</div>
      <div className="exp-properties">
        {group.properties.map((prop, pi) => (
          <div key={pi} className="exp-property">
            <span className="exp-property-name">{prop.name}</span>
            <div className="exp-weights">
              {Object.entries(prop.weights)
                .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                .map(([stat, weight]) => (
                  <span
                    key={stat}
                    className="exp-weight-chip"
                    title={STAT_NAMES[stat] ?? stat}
                  >
                    <span className="exp-weight-stat">{stat.toUpperCase()}</span>
                    <span className="exp-weight-value">{weight}%</span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Resource Slot (ranking table per ingredient class) ──────────────

function ResourceSlot({
  className,
  resources,
  loading,
  relevantStats,
  variant,
}: {
  className: string;
  resources: ScoredResource[];
  loading: boolean;
  relevantStats: StatKey[];
  variant: "active" | "history";
}) {
  const [expanded, setExpanded] = useState(false);
  const displayCount = expanded ? resources.length : 5;
  const shown = resources.slice(0, displayCount);
  const remaining = resources.length - 5;

  return (
    <div className={`resource-slot resource-slot--${variant}`}>
      <div className="resource-slot-header">
        <span className="resource-slot-class">{className}</span>
        <span className="resource-slot-count">
          {loading ? "loading..." : `${resources.length} available`}
        </span>
      </div>

      {loading && <LoadingSpinner message="Loading resources..." />}

      {!loading && resources.length === 0 && (
        <p className="profile-empty">
          {variant === "active"
            ? "No active resources for this class."
            : "No historical resources for this class."}
        </p>
      )}

      {!loading && resources.length > 0 && (
        <div className="resource-ranking">
          <div className="ranking-header-row">
            <span className="ranking-col ranking-col--rank">#</span>
            <span className="ranking-col ranking-col--name">Resource</span>
            <span className="ranking-col ranking-col--class">Class</span>
            <span className="ranking-col ranking-col--score">Score</span>
            {relevantStats.map((k) => (
              <span
                key={k}
                className="ranking-col ranking-col--stat"
                title={STAT_NAMES[k] ?? k}
              >
                {k.toUpperCase()}
              </span>
            ))}
          </div>
          {shown.map((r, i) => (
            <ResourceRankRow
              key={r.resourceId}
              resource={r}
              rank={i + 1}
              relevantStats={relevantStats}
              variant={variant}
            />
          ))}
          {remaining > 0 && !expanded && (
            <button
              className="ranking-more-btn"
              onClick={() => setExpanded(true)}
            >
              +{remaining} more resources
            </button>
          )}
          {expanded && remaining > 0 && (
            <button
              className="ranking-more-btn"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Resource Rank Row ───────────────────────────────────────────────

function ResourceRankRow({
  resource,
  rank,
  relevantStats,
  variant,
}: {
  resource: ScoredResource;
  rank: number;
  relevantStats: readonly StatKey[];
  variant: "active" | "history";
}) {
  const tier = scoreTierClass(resource.score);

  return (
    <Link
      to={`/resources/${resource.resourceId}`}
      className={`ranking-row ranking-row--${variant}`}
    >
      <span className="ranking-col ranking-col--rank">{rank}</span>
      <span className="ranking-col ranking-col--name">
        {resource.resourceName}
      </span>
      <span className="ranking-col ranking-col--class">
        {resource.resourceClass}
      </span>
      <span className={`ranking-col ranking-col--score ${tier}`}>
        {resource.score}
      </span>
      {relevantStats.map((k) => {
        const value = resource.stats[k];
        return (
          <span key={k} className="ranking-col ranking-col--stat">
            {value !== undefined ? value : "-"}
          </span>
        );
      })}
    </Link>
  );
}
