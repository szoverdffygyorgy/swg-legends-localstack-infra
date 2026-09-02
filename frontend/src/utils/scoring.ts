/**
 * Schematic scoring utilities.
 *
 * Computes weighted quality scores for resources against schematic
 * experimental properties. Used by both the Resource Profile (inline
 * score panel) and the Schematic Profile (resource ranking table).
 *
 * Scoring formula:
 *   property_score = sum( resource_stat * weight / 100 )
 *   overall_score  = average of all property scores
 *
 * Weights come from ExperimentalProperty.weights where each entry
 * maps a stat key to a percentage (weights sum to 100 per property).
 * The resulting score is 0-1000, matching the resource stat scale.
 */

import type {
  ExperimentalGroup,
  ExperimentalProperty,
  StatKey,
} from "../api/types";

/** Stat long names for tooltips and display. */
export const STAT_NAMES: Record<string, string> = {
  er: "Entangle Resistance",
  cr: "Cold Resistance",
  cd: "Conductivity",
  dr: "Decay Resistance",
  fl: "Flavor",
  hr: "Heat Resistance",
  ma: "Malleability",
  pe: "Potential Energy",
  oq: "Overall Quality",
  sr: "Shock Resistance",
  ut: "Unit Toughness",
};

/**
 * Flat stat record -- works with both ResourceItem (flat fields)
 * and HistoryResourceItem (also flat fields).
 */
export type FlatStats = Partial<Record<StatKey, number>>;

/**
 * Extract flat stats from any object with optional stat fields.
 * Safe to call on ResourceItem, HistoryResourceItem, or similar.
 */
export function extractStats(obj: Record<string, unknown>): FlatStats {
  const stats: FlatStats = {};
  const keys: StatKey[] = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];
  for (const k of keys) {
    if (typeof obj[k] === "number") {
      stats[k] = obj[k] as number;
    }
  }
  return stats;
}

/**
 * Compute the weighted score for a resource against a single
 * experimental property.
 *
 * Returns a value 0-1000.
 */
export function computePropertyScore(
  stats: FlatStats,
  property: ExperimentalProperty
): number {
  let score = 0;
  for (const [stat, weight] of Object.entries(property.weights)) {
    const value = stats[stat as StatKey];
    if (typeof value === "number" && typeof weight === "number") {
      score += value * weight / 100;
    }
  }
  return Math.round(score);
}

/**
 * Compute the overall weighted score for a resource across all
 * experimental groups. Averages all property scores.
 *
 * Returns a value 0-1000, or 0 if there are no properties.
 */
export function computeOverallScore(
  stats: FlatStats,
  groups: ExperimentalGroup[]
): number {
  const allProps = groups.flatMap((g) => g.properties);
  if (allProps.length === 0) return 0;
  const total = allProps.reduce(
    (sum, prop) => sum + computePropertyScore(stats, prop),
    0
  );
  return Math.round(total / allProps.length);
}

/**
 * CSS class for a score tier (0-1000 scale).
 * Uses the same purple > blue > green > yellow > red tiers
 * and thresholds as the raw stat display system.
 */
export function scoreTierClass(score: number): string {
  if (score >= 950) return "score--top";
  if (score >= 900) return "score--high";
  if (score >= 800) return "score--fair";
  if (score >= 500) return "score--mid";
  return "score--low";
}

/**
 * Collect the set of stat keys that are relevant for a schematic's
 * experimental groups (i.e., appear in at least one weight entry).
 */
export function getRelevantStats(groups: ExperimentalGroup[]): StatKey[] {
  const keys = new Set<StatKey>();
  for (const group of groups) {
    for (const prop of group.properties) {
      for (const k of Object.keys(prop.weights)) {
        keys.add(k as StatKey);
      }
    }
  }
  // Return in canonical order
  const order: StatKey[] = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];
  return order.filter((k) => keys.has(k));
}
