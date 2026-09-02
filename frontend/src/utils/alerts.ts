/**
 * Alert rule helpers.
 *
 * Shared by Resources and History pages for alert dropdown display
 * and client-side post-filtering of resources against alert criteria.
 */

import type { AlertRule } from "../api/types";

/**
 * Get normalized stat thresholds from an alert rule.
 * Handles the legacy single-stat format (stat + minValue) and the
 * current multi-stat format (statThresholds map).
 */
export function getAlertThresholds(rule: AlertRule): Record<string, number> {
  if (rule.statThresholds && Object.keys(rule.statThresholds).length > 0) return rule.statThresholds;
  if (rule.stat && rule.minValue !== undefined) return { [rule.stat]: rule.minValue };
  return {};
}

/**
 * Format an alert rule for dropdown display.
 * e.g., "Good Copper (Copper, OQ>=800 | Tatooine, Naboo)"
 */
export function formatAlertLabel(rule: AlertRule): string {
  const parts: string[] = [rule.name, `(${rule.classPattern}`];

  const thresholds = getAlertThresholds(rule);
  const statParts = Object.entries(thresholds).map(([k, v]) => `${k.toUpperCase()}>=${v}`);
  if (statParts.length > 0) parts.push(`, ${statParts.join(", ")}`);

  const planets = rule.planets ?? [];
  if (planets.length > 0) parts.push(` | ${planets.join(", ")}`);

  parts.push(")");
  return parts.join("");
}

/**
 * Check if a resource matches an alert's stat thresholds and planet filter.
 *
 * Accepts stats as a partial record (stat keys -> values) and planets as
 * a string array, so it works with both ResourceItem and HistoryResourceItem
 * shapes -- the caller normalizes their item before calling.
 *
 * @param resource - Any object with optional stat keys as top-level number properties
 * @param planets - The resource's planets as an array (e.g., ["Tatooine", "Naboo"])
 * @param rule - The alert rule to match against
 */
export function resourceMatchesAlert<T extends object>(
  resource: T,
  planets: string[],
  rule: AlertRule
): boolean {
  // Check stat thresholds (AND logic: all must be met)
  const thresholds = getAlertThresholds(rule);
  for (const [stat, minVal] of Object.entries(thresholds)) {
    const val = (resource as Record<string, unknown>)[stat] as number | undefined;
    if (val === undefined || val < minVal) return false;
  }

  // Check planet filter (OR logic: resource must be on at least one listed planet)
  const rulePlanets = rule.planets ?? [];
  if (rulePlanets.length > 0) {
    const rulePlanetSet = new Set(rulePlanets);
    if (!planets.some((p) => rulePlanetSet.has(p))) return false;
  }

  return true;
}

/**
 * Extract planets as an array from a ResourceItem.
 * ResourceItem has `allPlanets` (comma-separated) and `planet` (single).
 */
export function getResourcePlanets(r: { allPlanets?: string; planet?: string }): string[] {
  if (r.allPlanets) return r.allPlanets.split(", ");
  if (r.planet) return [r.planet];
  return [];
}

/**
 * Extract planets as an array from a HistoryResourceItem.
 * HistoryResourceItem has `planets` (comma-separated string).
 */
export function getHistoryPlanets(r: { planets: string }): string[] {
  return r.planets ? r.planets.split(", ") : [];
}
