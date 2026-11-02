// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import type { InstallationRow, InstallationUpsert } from '../installation-state.ts';
import { createInstallationStore, type InstallationStore } from '../installation-store.ts';

/** A stored tenant: its installation row and the GitHub ids of the repositories it holds. */
interface TenantFixture {
  readonly installation: InstallationRow;
  readonly repoIds: readonly [GithubId, GithubId];
}

export interface World {
  readonly db: Kysely<Database>;
  readonly store: InstallationStore;
  readonly a: TenantFixture;
  readonly b: TenantFixture;
}

export const DECIDED_AT = new Date('2026-05-01T10:00:00Z');

function snapshotOf(n: number): InstallationUpsert {
  return {
    githubInstallationId: parseGithubId(n * 100),
    accountId: parseGithubId(n * 1000),
    accountLogin: `org-${n}`,
    accountType: 'Organization',
    suspendedAt: null,
  };
}

/** An installation of an organisation, admitted; `n` makes every id unique (GitHub installation id n * 100). */
export function installationOf(n: number, overrides: Partial<InstallationUpsert> = {}): InstallationUpsert {
  return { ...snapshotOf(n), admission: { status: 'admitted', reason: null, decidedAt: DECIDED_AT }, ...overrides };
}

/** The same installation as GitHub describes it, with no admission decision made. */
export function undecidedInstallationOf(
  n: number,
  overrides: Omit<Partial<InstallationUpsert>, 'admission'> = {},
): InstallationUpsert {
  return { ...snapshotOf(n), ...overrides };
}

/** The GitHub id of repository `index` of tenant `n`. */
export const repoId = (n: number, index: number): GithubId => parseGithubId(n * 10_000 + index);

/** A repository as GitHub lists it. */
export const listed = (n: number, index: number, fullName = `org-${n}/repo-${index}`) => ({
  githubRepoId: repoId(n, index),
  fullName,
});

async function tenant(store: InstallationStore, n: number): Promise<TenantFixture> {
  const installation = await store.upsertInstallation(installationOf(n));
  await store.upsertRepositories(installation.id, [listed(n, 1), listed(n, 2)]);
  return { installation, repoIds: [repoId(n, 1), repoId(n, 2)] };
}

/** A migrated database holding two admitted tenants, A and B, with two repositories each, all enabled = false. */
export async function worldOfTwoTenants(): Promise<World> {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  return { db, store, a: await tenant(store, 1), b: await tenant(store, 2) };
}
