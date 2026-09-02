import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient instance for the app.
 *
 * Defaults:
 * - retry: 1 (one retry on failure, then show error)
 * - staleTime: 30s (data is "fresh" for 30s after fetch -- no refetch on mount)
 * - gcTime: 5m (unused cache entries garbage-collected after 5 minutes)
 * - refetchOnWindowFocus: true (refresh when user tabs back in)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  },
});
