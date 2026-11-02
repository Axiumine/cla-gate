// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ConfigError } from './env.ts';
import { databaseUrlField } from './env-fields.ts';
import type { Secret } from './secret.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * What `yarn db:migrate` needs: the owner connection. Migrations create tables, so they cannot run as the
 * unprivileged runtime role in `DATABASE_URL`; `MIGRATION_DATABASE_URL` wins when set. Outside production it may be
 * left out and the migration falls back to `DATABASE_URL` (a single-role development database); in production it is
 * required, because tables created by the runtime role would be owned by it, and an owner can disable the triggers
 * that keep the signatures immutable (E04-S07).
 */
export function loadMigrateConfig(env: Env): { readonly databaseUrl: Secret } {
  const owner = env['MIGRATION_DATABASE_URL'] ?? '';
  const useOwner = owner !== '';
  if (!useOwner && env['NODE_ENV'] === 'production') {
    throw new ConfigError(['MIGRATION_DATABASE_URL']);
  }
  const name = useOwner ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  const result = databaseUrlField.safeParse(useOwner ? owner : env['DATABASE_URL']);
  if (!result.success) {
    throw new ConfigError([name]);
  }
  return { databaseUrl: result.data };
}
