// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { type operatorInstallationsResponseSchema, operatorInstallationsRoute } from '../../shared/operator.ts';
import { type ApiClient, ApiError } from '../api/index.ts';

// The query of the operator screen (E18-S13). The instance operator is not a tenant role: the endpoint answers `404 not_found`
// to everyone else, which is not a failure but the answer "you are not the operator", so the query turns it into data. The
// user menu and the page read the same query, and its key belongs to the person (no tenant), so a logout drops it with the rest.

/** One installation as the operator sees it: ids, display snapshots of the account, states, times and counts, no personal data. */
export type OperatorInstallation = z.infer<typeof operatorInstallationsResponseSchema>['installations'][number];

/** What the endpoint said: the person is not the operator, or is, and these are the installations of the instance. */
export type OperatorView =
  | { readonly operator: false }
  | { readonly operator: true; readonly installations: readonly OperatorInstallation[] };

/**
 * The key of the query: the person's, not a tenant's.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const OPERATOR_KEY = ['operator', 'installations'] as const;

const NOT_FOUND = 404;

/** Asks the server. A `404` is "not the operator"; anything else that goes wrong is thrown and shown by the page that asked. */
async function fetchOperatorView(client: ApiClient, signal: AbortSignal): Promise<OperatorView> {
  try {
    const { installations } = await client.call(operatorInstallationsRoute, undefined, { signal });
    return { operator: true, installations };
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) {
      return { operator: false };
    }
    throw error;
  }
}

/** `GET /api/operator/installations` (E11-S08) through the typed client. */
export function operatorQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: OPERATOR_KEY,
    queryFn: ({ signal }) => fetchOperatorView(client, signal),
  });
}
