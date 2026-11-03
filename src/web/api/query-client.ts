// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors.ts';

/**
 * Data is fresh for 30 seconds, and kept for 5 minutes after the last component stopped using it.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const STALE_TIME_MS = 30_000;
/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
export const GC_TIME_MS = 300_000;
/**
 * A failed query is tried again at most twice, so three requests in all.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_QUERY_RETRIES = 2;
const FIRST_SERVER_ERROR = 500;

/**
 * Whether a failed query runs again: never after the server refused it (a status below 500: the same request gets the
 * same answer), and up to {@link MAX_QUERY_RETRIES} times after a server error, a network error or anything else.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < FIRST_SERVER_ERROR) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

/** The app's TanStack Query client. A mutation is never retried: it may have changed something. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, staleTime: STALE_TIME_MS, gcTime: GC_TIME_MS },
      mutations: { retry: false },
    },
  });
}
