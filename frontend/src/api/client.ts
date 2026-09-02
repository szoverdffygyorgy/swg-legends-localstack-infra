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
  EventListResponse,
  AlertRulesResponse,
  CreateRuleResponse,
  AlertHistoryResponse,
  ClassTreeNode,
  PipelineStatusResponse,
  OpsDashboardResponse,
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

export async function getAlertHistory(): Promise<AlertHistoryResponse> {
  return fetchJson<AlertHistoryResponse>(`${BASE}/alerts/history`);
}

// ─── Pipeline ────────────────────────────────────────────────────────

export async function getPipelineStatus(): Promise<PipelineStatusResponse> {
  return fetchJson<PipelineStatusResponse>(`${BASE}/pipeline/status`);
}

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
// (Vite public/ in dev, S3 bucket in production). Fetched once and
// cached in memory.

let classTreeCache: ClassTreeNode[] | null = null;

export async function getClassTree(): Promise<ClassTreeNode[]> {
  if (classTreeCache) return classTreeCache;

  const response = await fetch("/resource-class-tree.json");
  if (!response.ok) {
    throw new Error(`Failed to load class tree: ${response.status}`);
  }
  classTreeCache = (await response.json()) as ClassTreeNode[];
  return classTreeCache;
}
