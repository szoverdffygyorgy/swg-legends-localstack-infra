/**
 * Stat quality display helpers.
 *
 * Shared by Resources and History pages for consistent stat rendering.
 * Quality is computed relative to the stat's min/max caps from the
 * resource class hierarchy. Raw value tiers are absolute thresholds.
 */

/**
 * Compute quality percentage relative to a stat's cap range.
 * Returns null if the value or caps are not available.
 */
export function statQuality(
  value: number | undefined,
  caps: [number, number] | undefined
): number | null {
  if (value === undefined || !caps) return null;
  const [min, max] = caps;
  if (max === min) return value >= max ? 100 : 0;
  return Math.round(((value - min) / (max - min)) * 100);
}

/**
 * CSS class for quality percentage tier (cap-relative).
 * Purple > Blue > Green > Yellow > Red
 */
export function qualityClass(quality: number | null): string {
  if (quality === null) return "qual-mid";
  if (quality >= 95) return "qual-top";
  if (quality >= 90) return "qual-high";
  if (quality >= 80) return "qual-fair";
  if (quality >= 50) return "qual-mid";
  return "qual-low";
}

/**
 * CSS class for raw stat value tier (absolute thresholds).
 * Purple > Blue > Green > Yellow > Red
 */
export function rawValueClass(val: number): string {
  if (val >= 950) return "raw-top";
  if (val >= 900) return "raw-high";
  if (val >= 800) return "raw-fair";
  if (val >= 500) return "raw-mid";
  return "raw-low";
}
