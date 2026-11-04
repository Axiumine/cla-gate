// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ConfigError } from './config-error.ts';
import { databaseUrlField } from './env-fields.ts';
import { ruleOf } from './env-rules.ts';
import type { Secret } from './secret.ts';
import { resolveSecretFiles } from './secret-files.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * What `yarn db:migrate` needs: the owner connection. Migrations create tables, so they cannot run as the
 * unprivileged runtime role in `DATABASE_URL`; `MIGRATION_DATABASE_URL` wins when set. Outside production it may be
 * left out and the migration falls back to `DATABASE_URL` (a single-role development database); in production it is
 * required, because tables created by the runtime role would be owned by it, and an owner can disable the triggers
 * that keep the signatures immutable (E04-S07). Each of the two may come from its `_FILE` variant (E19-S02), read by the
 * same resolver as the server's secrets; `DATABASE_URL_FILE` is read only when the owner connection is not set, so an
 * unreadable file of the runtime role never stops a migration that does not use it.
 */
export function loadMigrateConfig(env: Env): { readonly databaseUrl: Secret } {
  const owner = resolveSecretFiles(env, ['MIGRATION_DATABASE_URL']);
  if (owner.issues.length > 0) {
    throw new ConfigError(owner.issues);
  }
  const ownerUrl = owner.env['MIGRATION_DATABASE_URL'] ?? '';
  const useOwner = ownerUrl !== '';
  if (!useOwner && env['NODE_ENV'] === 'production') {
    throw new ConfigError([
      { variable: 'MIGRATION_DATABASE_URL', rule: 'required in production; set it, or MIGRATION_DATABASE_URL_FILE' },
    ]);
  }
  const runtime = useOwner ? owner : resolveSecretFiles(env, ['DATABASE_URL']);
  if (runtime.issues.length > 0) {
    throw new ConfigError(runtime.issues);
  }
  const name = useOwner ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  const result = databaseUrlField.safeParse(new Map(Object.entries(runtime.env)).get(name));
  if (!result.success) {
    const rule = useOwner ? 'must be a postgres:// or postgresql:// connection string' : ruleOf('DATABASE_URL');
    throw new ConfigError([{ variable: name, rule }]);
  }
  return { databaseUrl: result.data };
}
