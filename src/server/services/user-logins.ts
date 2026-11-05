// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';

// The login of a person as this instance last saw it (E16-S02, E15-S07). The numeric GitHub id is the identity; the login in `users` is a
// display snapshot, which is `erased-<id>` once the person was erased (E16-S04).

/**
 * The login of each person in `githubIds` as the `users` snapshot holds it now. A person it has no row for is missing from the map. The ids
 * travel as one array parameter, so a list of any length is one statement and never runs into the limit on the number of parameters.
 */
export async function loginsOf(db: Kysely<Database>, githubIds: readonly number[]): Promise<Map<number, string>> {
  const ids = [...new Set(githubIds)];
  if (ids.length === 0) {
    return new Map();
  }
  const users = await db
    .selectFrom('users')
    .select(['github_id', 'login'])
    .where(sql<boolean>`github_id = any(${ids}::bigint[])`)
    .execute();
  return new Map(users.map((user) => [user.github_id, user.login]));
}
