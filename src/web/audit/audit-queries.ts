// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { auditLogRoute } from '../../shared/audit-log-routes.ts';
import type { SuccessOf } from '../../shared/contract.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import type { AuditFilters } from './audit-filters.ts';

// The query of the audit screen (E18-S09). Every key starts with `['installation', installationId]` (E18-S04), so the log of one tenant
// is kept and dropped as a unit and never found under another tenant's key.

/** One page of the log, as the endpoint sends it. */
type AuditPage = SuccessOf<typeof auditLogRoute>;

/** One audit row of a page. */
export type AuditEvent = AuditPage['items'][number];

/**
 * How many rows a page holds: the endpoint takes 1 to 200 and this screen asks for 50, which is also its default.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const AUDIT_PAGE_SIZE = 50;

/**
 * The start of the key of every query about the audit log of one installation.
 * @internal Exported for the tests, which find the cached log of a tenant by it (Knip ignores `@internal` exports in production mode).
 */
export function auditKey(installationId: number) {
  return [...installationKey(installationId), 'audit'] as const;
}

/** What a page is asked for: the filters of the address and the cursor of the page. */
export interface AuditRequest {
  readonly filters: AuditFilters;
  readonly cursor: string | undefined;
}

/**
 * `GET /api/installations/:installationId/audit-log?limit=50&action=&actorGithubId=&subjectType=&subjectId=&from=&to=&cursor=`
 * (E16-S02). The installation is the one in the path, which the server filters every row by. A page is kept under the filters and its
 * cursor; the page on screen stays until the next one of the same search is there (the screen is remounted for another installation or
 * other filters, so it never shows the rows of another one), and the answer is asked for again on every visit.
 */
export function auditQueryOptions(client: ApiClient, installationId: number, { filters, cursor }: AuditRequest) {
  return queryOptions({
    queryKey: [
      ...auditKey(installationId),
      filters.action ?? null,
      filters.actorGithubId ?? null,
      filters.subjectType ?? null,
      filters.subjectId ?? null,
      filters.from ?? null,
      filters.to ?? null,
      cursor ?? null,
    ] as const,
    queryFn: ({ signal }) =>
      client.call(
        auditLogRoute,
        { params: { installationId }, query: { limit: AUDIT_PAGE_SIZE, ...filters, cursor } },
        { signal },
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
