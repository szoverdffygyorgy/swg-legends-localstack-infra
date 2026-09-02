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

  // Classification fields -- populated by looking up resourceClass
  // in the resource-classes hierarchy table at ingestion time.
  // Optional because legacy items may not have been backfilled yet.

  /** Materialized hierarchy path (e.g., "inorganic/mineral/metal/non-ferrous_metal/copper/desh_copper") */
  classPath?: string;

  /** Top-level category (e.g., "Inorganic", "Organic", "Energy", "Space Resource") */
  classCategory?: string;

  /** Second-level group (e.g., "Mineral", "Creature Resources", "Renewable Energy") */
  classGroup?: string;

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

// ─── Diff result ─────────────────────────────────────────────────────
// Produced by the diff engine when comparing the fresh XML export
// against the current DynamoDB state.

export interface DiffResult {
  /** Resources in the XML but not in DynamoDB (newly spawned) */
  spawned: SWGResource[];

  /** Resources in DynamoDB but not in the XML (despawned) */
  despawned: ResourceItem[];

  /** Count of resources that exist in both (no change) */
  unchanged: number;

  /** Resources with data quality problems (e.g., empty planet names) */
  dataIssues: DataIssue[];
}

// ─── Data quality issues ─────────────────────────────────────────────
// Tracked when the XML export contains resources with invalid data
// (e.g., missing planet names). These are logged to the event-log table
// as DATA_ISSUE events instead of being silently dropped.

export interface DataIssue {
  /** SWGAide resource ID */
  resourceId: string;

  /** Resource name */
  resourceName: string;

  /** Resource class */
  resourceClass: string;

  /** Description of what went wrong */
  issue: string;

  /** Raw planet data from the XML (for debugging) */
  rawPlanets: string;
}

// ─── Resource class hierarchy ────────────────────────────────────────
// Represents a node in SWG's resource class tree. The tree has 816 nodes
// (104 branch, 712 leaf) across 4 root categories: Energy, Inorganic,
// Organic, Space Resource. Max depth is 6.
//
// Leaf nodes are the actual resource types that spawn in-game (e.g.,
// "Desh Copper"). Branch nodes are groupings (e.g., "Copper", "Metal").
// Each node has stat caps defining the min/max possible values for
// resources of that class.

export interface ResourceClassNode {
  /** Slugified class name, used as DynamoDB primary key (e.g., "desh_copper") */
  classId: string;

  /** Human-readable class name (e.g., "Desh Copper") */
  className: string;

  /** Parent's classId, or null for root nodes (e.g., "copper") */
  parentClassId: string | null;

  /** Parent's human-readable name, or null for root nodes */
  parentName: string | null;

  /**
   * Materialized path from root to this node, slash-separated.
   * e.g., "inorganic/mineral/metal/non-ferrous_metal/copper/desh_copper"
   * Enables prefix queries: begins_with(path, "inorganic/mineral/metal")
   * matches all metals.
   */
  path: string;

  /** Depth in the tree (0 = root categories like "Inorganic") */
  depth: number;

  /** True if this is a leaf node (actual spawnable resource type) */
  isLeaf: boolean;

  /**
   * Min/max stat caps for this class. Only includes stats that apply.
   * e.g., { cr: { min: 1, max: 116 }, cd: { min: 500, max: 572 } }
   */
  statCaps: Partial<Record<StatKey, { min: number; max: number }>>;
}

// ─── Event log item ──────────────────────────────────────────────────
// Stored in the event-log DynamoDB table. One item per spawn/despawn event.

export type EventType = "SPAWNED" | "DESPAWNED" | "DATA_ISSUE";

export interface EventLogItem {
  /** Partition key: date string (e.g., "2026-08-31") */
  date: string;

  /** Sort key: "timestamp#resourceId" for ordering + uniqueness */
  sk: string;

  /** The event type */
  eventType: EventType;

  /** Resource details */
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  planets: string;

  /** Key stats as a summary string (e.g., "OQ:978 DR:448") */
  statSummary: string;

  /** ISO timestamp of when the event was detected */
  detectedAt: string;

  /** Description of the data issue (only for DATA_ISSUE events) */
  issue?: string;
}

// ─── Schematic types ─────────────────────────────────────────────────
// Parsed from SWGAide's schematics_unity.xml.gz export. Each schematic
// describes a craftable item: what resources/components it requires,
// what stats matter (experimental groups), and metadata about the recipe.

/** A single ingredient in a schematic (resource or component). */
export interface SchematicIngredient {
  /** "resource" = raw resource class, "component" = crafted sub-component */
  type: "resource" | "component";

  /** SWGAide resource class abbreviation (e.g., "mtl", "cpr") -- resources only */
  classId?: string;

  /** Resolved class name from the class tree (e.g., "Metal", "Copper") -- resources only */
  className?: string;

  /** Slot description from the XML (e.g., "armor_segment_zam", "Synthesis Data Storage") */
  desc: string;

  /** Number of units required -- resources only */
  units?: number;

  /** Component schematic ID or name -- components only */
  componentId?: string;

  /** Component reference type: "schematic" (by ID) or "item" (by name) */
  componentType?: string;

  /** Number of components required -- components only */
  count?: number;

  /** Whether similar components can substitute */
  similar?: boolean;

  /** Whether this component is optional */
  optional?: boolean;
}

/** A single experimental property with stat weights. */
export interface ExperimentalProperty {
  /** Property name (e.g., "Armor Effectiveness", "Quality") */
  name: string;

  /**
   * Stat weights as percentages. Keys are stat abbreviations (er, cr, etc.).
   * Values sum to 100 within a property.
   * e.g., { oq: 50, sr: 50 } means OQ and SR each contribute 50%.
   */
  weights: Partial<Record<StatKey, number>>;
}

/** A group of related experimental properties. */
export interface ExperimentalGroup {
  /** Group name (e.g., "Experimental Quality", "Experimental Durability") */
  group: string;

  /** Properties within this group */
  properties: ExperimentalProperty[];
}

/** A fully parsed schematic from the SWGAide XML export. */
export interface Schematic {
  /** SWGAide schematic ID (unique) */
  schematicId: string;

  /** Schematic name (e.g., "Mabari Armorweave Boots") */
  name: string;

  /** SWGAide category ID */
  category: string;

  /** Game version: "nge" or "precu" */
  base: "nge" | "precu";

  /** Flavor text / description */
  description: string;

  /** Crafting complexity */
  complexity: number;

  /** XP gained from crafting */
  xp: number;

  /** Data pads required */
  dataSize: number;

  /** Can be manufactured in a factory */
  manufacture: boolean;

  /** Schematic type (e.g., "Regular") */
  type: string;

  /** Factory crate size (0 = not cratable) */
  crateSize: number;

  /** Quality indicator: "lq", "hq", "n/a", "mixed" */
  quality: string;

  /** Profession ID */
  profession: string;

  /** Required profession level */
  professionLevel: number;

  /** Resource and component ingredients */
  ingredients: SchematicIngredient[];

  /** Experimental groups with stat weights */
  experimentalGroups: ExperimentalGroup[];
}
