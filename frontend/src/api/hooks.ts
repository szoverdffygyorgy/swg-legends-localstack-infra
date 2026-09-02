/**
 * TanStack Query hooks for the SWG Legends REST API.
 *
 * Each hook wraps a client.ts function with useQuery or useMutation,
 * providing automatic caching, background refetching, loading/error
 * state, and cache invalidation after mutations.
 */

import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  getResources,
  getResourceById,
  getHistory,
  getHistoryById,
  getEvents,
  getAlertRules,
  createAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  getAlertHistory,
  getPipelineStatus,
  getOpsDashboard,
  getClassTree,
  getSchematicsByClass,
  getSchematicById,
  type ResourceFilters,
  type HistoryFilters,
} from "./client";
import type { AlertRule } from "./types";

// ─── Query key factory ──────────────────────────────────────────────
// Centralized key definitions prevent typos and make invalidation easy.

export const queryKeys = {
  classTree: ["classTree"] as const,
  alertRules: ["alertRules"] as const,
  alertHistory: ["alertHistory"] as const,
  resources: (filters: ResourceFilters) => ["resources", filters] as const,
  resource: (id: string) => ["resource", id] as const,
  history: (filters: HistoryFilters) => ["history", filters] as const,
  historyResource: (id: string) => ["historyResource", id] as const,
  events: (date: string, type?: string) => ["events", { date, type }] as const,
  pipelineStatus: ["pipelineStatus"] as const,
  opsDashboard: (logFunction: string) => ["opsDashboard", logFunction] as const,
  schematicsByClass: (className: string) => ["schematicsByClass", className] as const,
  schematic: (id: string) => ["schematic", id] as const,
};

// ─── Classification (static data) ───────────────────────────────────

/** Fetch the 816-node resource class hierarchy. Cached indefinitely. */
export function useClassTree() {
  return useQuery({
    queryKey: queryKeys.classTree,
    queryFn: getClassTree,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

// ─── Alert rules & history ──────────────────────────────────────────

export function useAlertRules() {
  return useQuery({
    queryKey: queryKeys.alertRules,
    queryFn: () => getAlertRules().then((d) => d.rules),
  });
}

export function useAlertHistory() {
  return useQuery({
    queryKey: queryKeys.alertHistory,
    queryFn: () => getAlertHistory().then((d) => d.alerts),
  });
}

// ─── Alert mutations ────────────────────────────────────────────────

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAlertRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alertRules });
      qc.invalidateQueries({ queryKey: queryKeys.alertHistory });
    },
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alertRules });
      qc.invalidateQueries({ queryKey: queryKeys.alertHistory });
    },
  });
}

export function useToggleAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleAlertRule,
    onMutate: async (ruleId: string) => {
      // Cancel any in-flight alertRules queries so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: queryKeys.alertRules });

      // Snapshot current cache for rollback
      const previousRules = qc.getQueryData<AlertRule[]>(queryKeys.alertRules);

      // Optimistically flip the enabled flag
      qc.setQueryData<AlertRule[]>(queryKeys.alertRules, (old) =>
        old?.map((rule) =>
          rule.ruleId === ruleId ? { ...rule, enabled: !rule.enabled } : rule
        )
      );

      return { previousRules };
    },
    onError: (_err, _ruleId, context) => {
      // Roll back to the snapshot on failure
      if (context?.previousRules) {
        qc.setQueryData(queryKeys.alertRules, context.previousRules);
      }
    },
    onSettled: () => {
      // Always refetch after settle to ensure server truth
      qc.invalidateQueries({ queryKey: queryKeys.alertRules });
    },
  });
}

// ─── Resources ──────────────────────────────────────────────────────

export function useResources(filters: ResourceFilters) {
  return useQuery({
    queryKey: queryKeys.resources(filters),
    queryFn: () => getResources(filters).then((d) => d.resources),
  });
}

export function useResource(id: string) {
  return useQuery({
    queryKey: queryKeys.resource(id),
    queryFn: () => getResourceById(id),
    enabled: !!id,
  });
}

// ─── History ────────────────────────────────────────────────────────

export function useHistory(filters: HistoryFilters, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.history(filters),
    queryFn: () => getHistory(filters).then((d) => d.resources),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useHistoryResource(id: string) {
  return useQuery({
    queryKey: queryKeys.historyResource(id),
    queryFn: () => getHistoryById(id),
    enabled: !!id,
  });
}

// ─── Events ─────────────────────────────────────────────────────────

export function useEvents(date: string, type?: string) {
  return useQuery({
    queryKey: queryKeys.events(date, type),
    queryFn: () => getEvents(date, type).then((d) => d.events),
  });
}

// ─── Pipeline status ────────────────────────────────────────────────

/**
 * Pipeline status with auto-refresh every 60s.
 * Powers the header "Synced: Xm ago" indicator -- the refetchInterval
 * ensures the display stays accurate without a manual tick timer.
 */
export function usePipelineStatus() {
  return useQuery({
    queryKey: queryKeys.pipelineStatus,
    queryFn: getPipelineStatus,
    refetchInterval: 60_000,
  });
}

// ─── Ops dashboard ──────────────────────────────────────────────────

export function useOpsDashboard(logFunction: string, autoRefresh: boolean) {
  return useQuery({
    queryKey: queryKeys.opsDashboard(logFunction),
    queryFn: () => getOpsDashboard(logFunction),
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}

// ─── Schematics ─────────────────────────────────────────────────────

/** Find schematics that use a resource class (hierarchy-aware). */
export function useSchematicsByClass(className: string) {
  return useQuery({
    queryKey: queryKeys.schematicsByClass(className),
    queryFn: () => getSchematicsByClass(className, true).then((d) => d.schematics),
    enabled: !!className,
  });
}

/** Get a single schematic by ID. */
export function useSchematic(id: string) {
  return useQuery({
    queryKey: queryKeys.schematic(id),
    queryFn: () => getSchematicById(id),
    enabled: !!id,
  });
}

// ─── Batch queries (for Schematic Profile) ──────────────────────────

/**
 * Fetch active resources for multiple class names in parallel.
 * Uses useQueries (single hook call) to avoid rules-of-hooks violations
 * when the number of classes changes between renders.
 */
export function useResourcesByClasses(classNames: string[]) {
  return useQueries({
    queries: classNames.map((cls) => ({
      queryKey: queryKeys.resources({ class: cls }),
      queryFn: () => getResources({ class: cls }).then((d) => d.resources),
    })),
  });
}

/**
 * Fetch history resources for multiple class names in parallel.
 * Only runs when enabled is true (lazy-loaded on user action).
 */
export function useHistoryByClasses(classNames: string[], enabled: boolean) {
  return useQueries({
    queries: classNames.map((cls) => ({
      queryKey: queryKeys.history({ class: cls }),
      queryFn: () => getHistory({ class: cls }).then((d) => d.resources),
      enabled,
    })),
  });
}
