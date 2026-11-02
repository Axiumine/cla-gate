// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { id, installation } from '../github-contract/test-support.ts';
import type { InstallationStore } from '../installation-store.ts';
import { listed } from '../store-fixture/test-support.ts';
import { FakeGitHub } from '../test-support.ts';

// What the repository admin discovery is tested with (E11-S03): repositories of the two tenants of `worldOfTwoTenants`
// (tenant 1 is the organisation `org-1` with GitHub installation id 100, tenant 2 `org-2` with 200), some of them with a
// repo-scoped CLA document, and a GitHub that serves both installations.

/** Stores repositories `org-<n>/repo-<index>` for tenant `n`, in the order given, so that their row ids follow that order. */
export async function addRepositories(
  store: InstallationStore,
  installationId: InstallationRowId,
  n: number,
  indexes: readonly number[],
): Promise<void> {
  await store.upsertRepositories(
    installationId,
    indexes.map((index) => listed(n, index)),
  );
}

/** Gives each named repository of the installation a document of its own (`repository_id` set), by display name. */
export async function scopeDocuments(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  fullNames: readonly string[],
  documentNames: readonly string[] = ['Individual CLA'],
): Promise<void> {
  const rows = await db
    .selectFrom('repositories')
    .select(['id', 'full_name'])
    .where('installation_id', '=', installationId)
    .where('full_name', 'in', fullNames)
    .execute();
  await db
    .insertInto('cla_documents')
    .values(
      rows.flatMap((row) =>
        documentNames.map((name) => ({
          installation_id: installationId,
          repository_id: row.id,
          name,
          kind: 'individual' as const,
          active_version_id: null,
        })),
      ),
    )
    .execute();
}

/** An installation-wide document: no repository, so it makes no repository a candidate. */
export async function installationDocument(db: Kysely<Database>, installationId: InstallationRowId): Promise<void> {
  await db
    .insertInto('cla_documents')
    .values({
      installation_id: installationId,
      repository_id: null,
      name: 'Installation CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .execute();
}

/** `org-<n>/repo-<index>` for each index. */
export const namesOf = (n: number, indexes: readonly number[]): string[] =>
  indexes.map((index) => `org-${n}/repo-${index}`);

/** `from`, `from + 1`, ... `to`. */
export const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, offset) => from + offset);

/** A GitHub that serves installation 100 (`org-1`, tenant 1) and installation 200 (`org-2`, tenant 2). */
export function githubOfTwoTenants(): FakeGitHub {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(100, 'org-1'));
  fake.addInstallation(installation(200, 'org-2'));
  return fake;
}

export const TENANT_ONE = id(100);
