// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from './schema.ts';
import type { LiveSession } from './sessions-model.ts';

// A session joined with its user, and the shape the rest of the server sees it in (E10-S01).

export function sessionWithUser(db: Kysely<Database>, hash: string) {
  return db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id',
      'sessions.csrf_secret',
      'sessions.created_at',
      'sessions.last_seen_at',
      'sessions.idle_expires_at',
      'sessions.absolute_expires_at',
      'users.id as user_id',
      'users.github_id',
      'users.login',
      'users.name',
      'users.avatar_url',
    ])
    .where('sessions.session_hash', '=', hash)
    .executeTakeFirst();
}

type SessionWithUser = NonNullable<Awaited<ReturnType<typeof sessionWithUser>>>;

export function toSession(row: SessionWithUser): LiveSession {
  return {
    rowId: row.session_id,
    user: {
      id: row.user_id,
      githubId: parseGithubId(row.github_id),
      login: row.login,
      name: row.name,
      avatarUrl: row.avatar_url,
    },
    csrfSecret: row.csrf_secret,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}
