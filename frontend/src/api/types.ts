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
  stat?: string;
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
