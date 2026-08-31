/**
 * TypeScript types for SWG Legends resource data.
 *
 * These types model the data from SWGAide's XML exports. Every resource
 * in the game has:
 * - A unique name and ID
 * - A resource class (e.g., "Copper", "Reactive Gas", "Wooly Hide")
 * - A set of stats (up to 11, but not every class has all 11)
 * - One or more planets where it spawns
 * - Metadata about when it was reported and by whom
 */

// ─── Resource stats ──────────────────────────────────────────────────
// Every resource has some subset of these 11 stats. The values range
// from 1-1000, with the possible range depending on the resource class.
//
// For crafting, different schematics weight different stats. A blaster
// might care about Conductivity and Overall Quality, while food cares
// about Flavor and Potential Energy.

export interface ResourceStats {
  er?: number; // Entangle Resistance
  cr?: number; // Cold Resistance
  cd?: number; // Conductivity
  dr?: number; // Decay Resistance
  fl?: number; // Flavor
  hr?: number; // Heat Resistance
  ma?: number; // Malleability
  pe?: number; // Potential Energy
  oq?: number; // Overall Quality
  sr?: number; // Shock Resistance
  ut?: number; // Unit Toughness
}

/** All possible stat keys */
export type StatKey = keyof ResourceStats;

/** List of all stat keys -- useful for iteration */
export const ALL_STAT_KEYS: StatKey[] = [
  "er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut",
];

// ─── Resource ────────────────────────────────────────────────────────
// This is the core domain object. It represents a single resource spawn
// as parsed from the SWGAide XML export.

export interface SWGResource {
  /** SWGAide resource ID (e.g., "1741089"). Unique per resource. */
  resourceId: string;

  /** In-game name (e.g., "Teiadi"). Unique per resource. */
  resourceName: string;

  /** Resource class / type (e.g., "Mustafarian Egg"). */
  resourceClass: string;

  /** SWGAide short type ID (e.g., "muegg"). */
  resourceClassId: string;

  /** Stats for this resource. Only includes stats that apply to this class. */
  stats: ResourceStats;

  /** Planets where this resource spawns. Most have 1, some have up to 8+. */
  planets: string[];

  /** Unix timestamp (seconds) when this resource was first reported. */
  availableTimestamp: number;

  /** Name of the player who reported this resource. */
  availableBy: string;
}

// ─── DynamoDB item ───────────────────────────────────────────────────
// When we store a resource in DynamoDB, we denormalize: one item per
// resource-planet combination. A resource on 3 planets becomes 3 items.
//
// This is the shape of what goes INTO DynamoDB and comes back OUT.
// It's flat (no nested objects for stats) because DynamoDB queries
// can filter on top-level attributes much more efficiently.

export interface ResourceItem {
  /** Partition key: SWGAide resource ID */
  resourceId: string;

  /** Sort key: planet name (one item per planet for multi-planet resources) */
  planet: string;

  /** Resource name (e.g., "Teiadi") */
  resourceName: string;

  /** Resource class (e.g., "Mustafarian Egg") */
  resourceClass: string;

  /** SWGAide short type ID (e.g., "muegg") */
  resourceClassId: string;

  /** All planets as a comma-separated string (for display, not querying) */
  allPlanets: string;

  /** Unix timestamp when reported */
  availableTimestamp: number;

  /** Reporter name */
  availableBy: string;

  // Stats are stored as top-level number attributes.
  // Only present if the resource class has that stat.
  er?: number;
  cr?: number;
  cd?: number;
  dr?: number;
  fl?: number;
  hr?: number;
  ma?: number;
  pe?: number;
  oq?: number;
  sr?: number;
  ut?: number;
}
