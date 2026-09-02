/**
 * Typed API client for the SWG Legends REST API.
 *
 * All requests go to /api/* which the Vite dev server proxies to
 * the LocalStack API Gateway. In production (S3 hosting), you'd
 * replace this with the full API Gateway URL.
 */

import type {
  ResourceListResponse,
  SingleResourceResponse,
  SingleHistoryResponse,
  EventListResponse,
  AlertRule,
  AlertRulesResponse,
  CreateRuleResponse,
  AlertHistoryResponse,
  HistoryListResponse,
  ClassTreeNode,
  PipelineStatusResponse,
  OpsDashboardResponse,
  SchematicListResponse,
  SchematicDetail,
} from "./types";

// In dev mode (Vite proxy), /api is proxied to LocalStack API Gateway.
// In production (S3 hosting), VITE_API_BASE_URL is the full API Gateway URL.
const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();

  if (!response.ok) {
    const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

// ─── Resources ───────────────────────────────────────────────────────

export interface ResourceFilters {
  planet?: string;
  class?: string;
  stat?: string;
  min?: number;
}

export async function getResources(
  filters: ResourceFilters = {}
): Promise<ResourceListResponse> {
  const params = new URLSearchParams();
  if (filters.planet) params.set("planet", filters.planet);
  if (filters.class) params.set("class", filters.class);
  if (filters.stat) params.set("stat", filters.stat);
  if (filters.min !== undefined) params.set("min", String(filters.min));

  const qs = params.toString();
  return fetchJson<ResourceListResponse>(
    `${BASE}/resources${qs ? `?${qs}` : ""}`
  );
}

export async function getResourceById(
  id: string
): Promise<SingleResourceResponse> {
  return fetchJson<SingleResourceResponse>(`${BASE}/resources/${id}`);
}

// ─── Events ──────────────────────────────────────────────────────────

export async function getEvents(
  date?: string,
  type?: string
): Promise<EventListResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (type) params.set("type", type);

  const qs = params.toString();
  return fetchJson<EventListResponse>(
    `${BASE}/events${qs ? `?${qs}` : ""}`
  );
}

// ─── Alerts ──────────────────────────────────────────────────────────

export async function getAlertRules(): Promise<AlertRulesResponse> {
  return fetchJson<AlertRulesResponse>(`${BASE}/alerts/rules`);
}

export async function createAlertRule(body: {
  name: string;
  classPattern: string;
  statThresholds?: Record<string, number>;
  planets?: string[];
}): Promise<CreateRuleResponse> {
  return fetchJson<CreateRuleResponse>(`${BASE}/alerts/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteAlertRule(ruleId: string): Promise<void> {
  await fetchJson<{ message: string }>(`${BASE}/alerts/rules/${ruleId}`, {
    method: "DELETE",
  });
}

export async function toggleAlertRule(ruleId: string): Promise<AlertRule> {
  const result = await fetchJson<{ rule: AlertRule }>(`${BASE}/alerts/rules/${ruleId}`, {
    method: "PUT",
  });
  return result.rule;
}

export async function getAlertHistory(): Promise<AlertHistoryResponse> {
  return fetchJson<AlertHistoryResponse>(`${BASE}/alerts/history`);
}

// ─── Pipeline ────────────────────────────────────────────────────────

export async function getPipelineStatus(): Promise<PipelineStatusResponse> {
  return fetchJson<PipelineStatusResponse>(`${BASE}/pipeline/status`);
}

// ─── History ─────────────────────────────────────────────────────────

export interface HistoryFilters {
  class?: string;
  stat?: string;
  min?: number;
  name?: string;
}

export async function getHistory(
  filters: HistoryFilters = {}
): Promise<HistoryListResponse> {
  const params = new URLSearchParams();
  if (filters.class) params.set("class", filters.class);
  if (filters.stat) params.set("stat", filters.stat);
  if (filters.min !== undefined) params.set("min", String(filters.min));
  if (filters.name) params.set("name", filters.name);

  const qs = params.toString();
  return fetchJson<HistoryListResponse>(
    `${BASE}/history${qs ? `?${qs}` : ""}`
  );
}

export async function getHistoryById(
  id: string
): Promise<SingleHistoryResponse> {
  return fetchJson<SingleHistoryResponse>(`${BASE}/history/${id}`);
}

// ─── Ops ─────────────────────────────────────────────────────────────

export async function getOpsDashboard(
  logFunction?: string
): Promise<OpsDashboardResponse> {
  const params = new URLSearchParams();
  if (logFunction) params.set("logFunction", logFunction);
  const qs = params.toString();
  return fetchJson<OpsDashboardResponse>(
    `${BASE}/ops/dashboard${qs ? `?${qs}` : ""}`
  );
}

// ─── Classification ──────────────────────────────────────────────────
// Static resource class hierarchy. Served from /resource-class-tree.json
// (Vite public/ in dev, S3 bucket in production). Cached by TanStack Query
// with staleTime: Infinity (see hooks.ts).

export async function getClassTree(): Promise<ClassTreeNode[]> {
  const response = await fetch("/resource-class-tree.json");
  if (!response.ok) {
    throw new Error(`Failed to load class tree: ${response.status}`);
  }
  return (await response.json()) as ClassTreeNode[];
}

// ─── Schematics ──────────────────────────────────────────────────────

export async function getSchematicsByClass(
  className: string,
  hierarchy = true
): Promise<SchematicListResponse> {
  const params = new URLSearchParams();
  params.set("class", className);
  if (hierarchy) params.set("hierarchy", "true");
  return fetchJson<SchematicListResponse>(
    `${BASE}/schematics?${params.toString()}`
  );
}

export async function getSchematicById(
  id: string
): Promise<SchematicDetail> {
  return fetchJson<SchematicDetail>(`${BASE}/schematics/${id}`);
}
