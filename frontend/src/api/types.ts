/** API response types matching Lambda handler output shapes. */

export interface ResourceItem {
  resourceId: string;
  planet: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  allPlanets: string;
  availableTimestamp: number;
  availableBy: string;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
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

export interface ResourceListResponse {
  count: number;
  filters: {
    planet?: string;
    class?: string;
    stat?: string;
    min?: number;
  };
  resources: ResourceItem[];
}

export interface SingleResourceResponse {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string[];
  availableTimestamp: number;
  availableBy: string;
  stats: Record<string, number>;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
}

export interface SingleHistoryResponse {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string[];
  availableTimestamp: number;
  availableBy: string;
  stats: Record<string, number>;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
  despawnedAt: string;
}

export interface EventLogItem {
  date: string;
  sk: string;
  eventType: "SPAWNED" | "DESPAWNED" | "DATA_ISSUE";
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  planets: string;
  statSummary: string;
  detectedAt: string;
  issue?: string;
}

export interface EventListResponse {
  date: string;
  count: number;
  filter?: string;
  events: EventLogItem[];
}

export interface AlertRule {
  ruleId: string;
  name: string;
  classPattern: string;
  statThresholds?: Record<string, number>;
  planets?: string[];
  /** @deprecated Use statThresholds instead */
  stat?: string;
  /** @deprecated Use statThresholds instead */
  minValue?: number;
  enabled: boolean;
  createdAt?: string;
}

export interface AlertRulesResponse {
  count: number;
  rules: AlertRule[];
}

export interface CreateRuleResponse {
  message: string;
  rule: AlertRule;
}

export interface FiredAlert {
  ruleId: string;
  ruleName: string;
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  planets: string;
  stats: Record<string, number>;
  matchedAt: string;
}

export interface AlertHistoryResponse {
  count: number;
  alerts: FiredAlert[];
}

export interface ApiError {
  error: string;
}

export const STAT_KEYS = [
  "er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

// ─── Resource history ────────────────────────────────────────────────
// Matches the api-get-history Lambda response shape.

export interface HistoryResourceItem {
  resourceId: string;
  despawnedAt: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  planets: string;
  classPath?: string;
  classCategory?: string;
  classGroup?: string;
  availableTimestamp: number;
  availableBy: string;
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

export interface HistoryListResponse {
  count: number;
  filters: {
    class?: string;
    stat?: string;
    min?: number;
    name?: string;
  };
  resources: HistoryResourceItem[];
}

// ─── Resource class hierarchy ────────────────────────────────────────
// Matches the shape of entries in resource-class-tree.json (static data).

export interface ClassTreeNode {
  nodeId: number;
  className: string;
  classId: string;
  parentNodeId: number;
  parentName: string | null;
  parentClassId: string | null;
  path: string;
  depth: number;
  isLeaf: boolean;
  statCaps: Partial<Record<StatKey, [number, number]>>;
}

// ─── Pipeline status ─────────────────────────────────────────────────

export interface PipelineLastSync {
  syncedAt: string;
  status: string;
  archiveS3Key: string;
  spawnedCount: number;
  despawnedCount: number;
  unchangedCount: number;
}

export interface PipelineStep {
  name: string;
  status: "entered" | "succeeded" | "failed";
}

export interface PipelineExecution {
  executionArn: string;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
  duration: string | null;
  steps: PipelineStep[];
  output?: Record<string, unknown>;
  error?: string;
  cause?: string;
}

export interface PipelineStatusResponse {
  lastSync: PipelineLastSync | null;
  executions: PipelineExecution[];
}

// ─── Ops dashboard ───────────────────────────────────────────────────

export interface LambdaMetric {
  name: string;
  invocations: number;
  errors: number;
}

export interface QueueHealth {
  name: string;
  pending: number;
  inFlight: number;
  dlqMessages: number;
}

export interface LogEntry {
  timestamp: number;
  message: string;
}

export interface OpsDashboardResponse {
  lastSync: PipelineLastSync | null;
  executions: PipelineExecution[];
  lambdaMetrics: LambdaMetric[];
  queues: QueueHealth[];
  recentLogs: LogEntry[];
  logFunction: string;
}

// ─── Schematics ──────────────────────────────────────────────────────

export interface SchematicSummary {
  schematicId: string;
  name: string;
  base: "nge" | "precu";
  category: string;
  matchedClass?: string;
  quality?: string;
  experimentalGroups?: ExperimentalGroup[];
}

export interface SchematicIngredient {
  type: "resource" | "component";
  classId?: string;
  className?: string;
  desc: string;
  units?: number;
  componentId?: string;
  componentType?: string;
  count?: number;
  similar?: boolean;
  optional?: boolean;
}

export interface ExperimentalProperty {
  name: string;
  weights: Partial<Record<StatKey, number>>;
}

export interface ExperimentalGroup {
  group: string;
  properties: ExperimentalProperty[];
}

export interface SchematicDetail {
  pk: string;
  sk: string;
  schematicId: string;
  name: string;
  category: string;
  base: "nge" | "precu";
  description?: string;
  complexity: number;
  xp: number;
  dataSize: number;
  manufacture: boolean;
  type: string;
  crateSize: number;
  quality: string;
  profession: string;
  professionLevel: number;
  ingredients: SchematicIngredient[];
  experimentalGroups: ExperimentalGroup[];
}

export interface SchematicListResponse {
  count: number;
  filters: Record<string, unknown>;
  schematics: SchematicSummary[];
}
