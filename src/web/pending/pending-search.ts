// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { PENDING_REASON_CODES } from '../../shared/pending-prs.ts';

// What the address of the pending screen holds (E18-S08): `/installations/$installationId/pending?tab=&repository=&reason=&cursor=`, the
// tab, the filters and the page the person is looking at, so a reload, a pasted link and the browser's Back land on the same view.
// Every value is checked and a value that is not one is dropped: the screen then shows what it would without it.

/** The longest `cursor` the endpoints read (1 to 1024 characters, the bound of every paged list). */
const MAX_CURSOR_LENGTH = 1024;

/**
 * The two tabs of the screen.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PENDING_TABS = ['pending', 'overrides'] as const;

export type PendingTab = (typeof PENDING_TABS)[number];

/**
 * `?tab=overrides` is the second tab and no `tab` is the first; `?repository=` is `repositories.id` as a positive whole number (the
 * filter of the pending list, the choice of the overrides); `?reason=` is one of the reasons of the list; `?cursor=` is a text of the
 * length the endpoints take and is kept and handed back, never read. The ids are only ever sent in a request that the server filters by
 * tenant, so an id of another tenant is the uniform `404` and never data.
 */
export const pendingSearchSchema = z.object({
  tab: z.literal('overrides').optional().catch(undefined),
  repository: z.int().positive().optional().catch(undefined),
  reason: z.enum(PENDING_REASON_CODES).optional().catch(undefined),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
});

export type PendingSearch = z.infer<typeof pendingSearchSchema>;

/** The tab an address names. */
export function tabOf(search: PendingSearch): PendingTab {
  return search.tab ?? 'pending';
}

/** The tab a Radix value stands for: `overrides` is the second one, anything else the first. */
export function tabFromValue(value: string): PendingTab {
  return value === 'overrides' ? 'overrides' : 'pending';
}
