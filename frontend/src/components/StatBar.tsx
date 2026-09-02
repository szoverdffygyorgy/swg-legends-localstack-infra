/**
 * StatBar: Visual stat indicator with cap range visualization.
 *
 * Shows a horizontal bar on a 0-1000 scale with:
 * - The full bar as background (0-1000)
 * - A highlighted region showing the possible cap range [capMin, capMax]
 * - A filled portion within the cap range showing the actual value
 * - Color-coded by raw value tier (same 5-tier scale as the data tables)
 */

interface StatBarProps {
  statKey: string;
  value: number;
  capMin: number;
  capMax: number;
}

function qualityPercent(value: number, capMin: number, capMax: number): number {
  if (capMax === capMin) return value >= capMax ? 100 : 0;
  return Math.round(((value - capMin) / (capMax - capMin)) * 100);
}

/** Color tier based on raw stat value (absolute thresholds, not cap-relative). */
function tierClass(value: number): string {
  if (value >= 950) return "stat-bar--top";
  if (value >= 900) return "stat-bar--high";
  if (value >= 800) return "stat-bar--fair";
  if (value >= 500) return "stat-bar--mid";
  return "stat-bar--low";
}

export default function StatBar({ statKey, value, capMin, capMax }: StatBarProps) {
  const quality = qualityPercent(value, capMin, capMax);
  const tier = tierClass(value);

  // Position the cap range on the 0-1000 scale
  const rangeLeft = (capMin / 1000) * 100;
  const rangeWidth = ((capMax - capMin) / 1000) * 100;

  // Fill within the cap range (clamped to 0-100%)
  const fillPercent = Math.max(0, Math.min(100, quality));

  return (
    <div className="stat-bar-row">
      <span className="stat-bar-label">{statKey.toUpperCase()}</span>
      <div className="stat-bar-track">
        {/* Cap range highlight */}
        <div
          className="stat-bar-range"
          style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
        >
          <span className="stat-bar-cap stat-bar-cap--min">{capMin}</span>
          <span className="stat-bar-cap stat-bar-cap--max">{capMax}</span>
          {/* Value fill within the cap range */}
          <div
            className={`stat-bar-fill ${tier}`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      </div>
      <span className="stat-bar-value">
        <span className={`stat-bar-number ${tier}`}>{value}</span>
        <span className="stat-bar-quality">({quality}%)</span>
      </span>
    </div>
  );
}
