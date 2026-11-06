// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { at, insertRow } from './insert.ts';

// E18-S12: an installation (the tenant) and a repository of it as rows, as the synchronisation with GitHub would have written them.

const CREATED = at('2026-01-05T09:00:00Z');

export async function installation(
  db: Kysely<Database>,
  tenant: { readonly id: number; readonly githubId: number; readonly login: string },
  accountId: number,
): Promise<void> {
  await insertRow(db, 'installations', {
    id: tenant.id,
    github_installation_id: tenant.githubId,
    account_id: accountId,
    account_login: tenant.login,
    account_type: 'User',
    admission_status: 'admitted',
    admission_decided_at: CREATED,
    last_synced_at: CREATED,
    created_at: CREATED,
    updated_at: CREATED,
  });
}

export async function repository(
  db: Kysely<Database>,
  tenantId: number,
  repo: { readonly id: number; readonly githubId: number; readonly name: string },
): Promise<void> {
  await insertRow(db, 'repositories', {
    id: repo.id,
    installation_id: tenantId,
    github_repo_id: repo.githubId,
    full_name: repo.name,
    created_at: CREATED,
    updated_at: CREATED,
  });
}
