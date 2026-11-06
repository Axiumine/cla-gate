// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { REPOSITORIES, TENANT } from './ids.ts';
import { at, insertRow } from './insert.ts';
import { ALICE, BOT, ERIN, GRACE } from './people.ts';
import { rowIdOf } from './people-rows.ts';

// E18-S12: the allowlist of the seeded tenant: two entries for the whole installation (a person and a bot) and one for a repository.

/** Writes the three entries. Call inside `withFixedHistory`. */
export async function seedAllowlist(db: Kysely<Database>): Promise<void> {
  const alice = await rowIdOf(db, ALICE);
  const entries = [
    { id: 9501, who: GRACE, kind: 'user', repositoryId: null, when: '2026-02-10T09:00:00Z' },
    { id: 9502, who: BOT, kind: 'bot', repositoryId: null, when: '2026-02-11T09:00:00Z' },
    { id: 9503, who: ERIN, kind: 'user', repositoryId: REPOSITORIES.widgets.id, when: '2026-03-01T09:00:00Z' },
  ] as const;
  for (const entry of entries) {
    await insertRow(db, 'allowlist_entries', {
      id: entry.id,
      installation_id: TENANT.id,
      repository_id: entry.repositoryId,
      kind: entry.kind,
      github_id: entry.who.githubId,
      login_snapshot: entry.who.login,
      created_by: alice,
      created_at: at(entry.when),
    });
  }
}
