// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ListedEntryResponse } from '../../../shared/allowlist.ts';
import type { ListedEntry } from '../../services/allowlist-entry-types.ts';

// The entries of the lists as the routes of allowlist-entry-list-routes.ts send them (E14-S07): the stored rows with their times as
// ISO 8601 (UTC). Strings (the login snapshot, the login of the person who made the entry) are sent as they are stored; escaping is
// each screen's job (E18).

/** An entry as `listedEntrySchema` has it; `readOnly` marks one the list shows but its reader cannot remove from there. */
export function presentListedEntry(entry: ListedEntry, readOnly: boolean): ListedEntryResponse {
  return {
    id: entry.id,
    scope: entry.scope,
    repositoryId: entry.repositoryId,
    kind: entry.kind,
    githubId: entry.githubId,
    loginSnapshot: entry.loginSnapshot,
    createdBy: { githubId: entry.createdBy.githubId, login: entry.createdBy.login },
    createdAt: entry.createdAt.toISOString(),
    readOnly,
  };
}
