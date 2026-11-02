// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, KyselyPlugin } from 'kysely';
import { parseGithubId } from '../../../shared/github-id.ts';
import { loadMigrationFiles } from '../../adapters/db/migration-files.ts';
import { migrate } from '../../adapters/db/migrator.ts';
import { openPgliteDatabase } from '../../adapters/db/pglite.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { MIGRATIONS_DIRECTORY } from '../../adapters/db/test-support.ts';
import { FIXTURE_IDS } from '../../adapters/github/webhook-fixture/test-support.ts';
import type { InstallationUpsert } from '../installation-state.ts';
import { createInstallationStore } from '../installation-store.ts';

// The tenants of the tests of the tenant filter (E06-S05) and of every route test whose delivery names one. The admitted
// tenant is the one the webhook fixtures name (`FIXTURE_IDS.installation`, `FIXTURE_IDS.repository`), so an unchanged
// fixture is a delivery of a tenant the instance serves; the others are reached by changing the ids of the payload.

/** A tenant a test names: its GitHub installation id and the GitHub id of its repository. */
interface TenantIds {
  readonly installation: number;
  readonly repository: number;
}

/** The tenants: five stored installations, each with one repository, and one the database has never heard of. */
export const TENANT = {
  /** Admitted and active: the tenant of the fixtures. */
  admitted: { installation: FIXTURE_IDS.installation, repository: FIXTURE_IDS.repository },
  /** The policy rejected its account (E05-S07). */
  rejected: { installation: 31_002, repository: 52_003 },
  /** Admitted, then suspended on GitHub. */
  suspended: { installation: 31_003, repository: 52_004 },
  /** Admitted, then uninstalled. */
  deleted: { installation: 31_004, repository: 52_005 },
  /** A second admitted tenant: the one a repository is stored under after a transfer the first has not heard of. */
  other: { installation: 31_005, repository: 52_006 },
  /** No row: an installation whose `installation.created` was missed. */
  unknown: { installation: 31_999, repository: 52_999 },
} as const satisfies Readonly<Record<string, TenantIds>>;

/** A repository of the admitted tenant that is not stored: its row does not exist yet (the event came first). */
export const UNSTORED_REPOSITORY = 52_998;

const DECIDED_AT = new Date('2026-05-01T10:00:00Z');
const LATER = new Date('2026-06-01T12:00:00Z');

const admission = { status: 'admitted', reason: null, decidedAt: DECIDED_AT } as const;
const rejection = { status: 'rejected', reason: 'account_not_allowed', decidedAt: DECIDED_AT } as const;

function installationOf(ids: TenantIds, overrides: Partial<InstallationUpsert>): InstallationUpsert {
  return {
    githubInstallationId: parseGithubId(ids.installation),
    accountId: parseGithubId(ids.installation + 1_000),
    accountLogin: `account-${ids.installation}`,
    accountType: 'Organization',
    suspendedAt: null,
    admission,
    ...overrides,
  };
}

/** Stores the five tenants of {@link TENANT} with one repository each, enforcement off, as the sync (E05-S08) leaves them. */
export async function seedTenants(db: Kysely<Database>): Promise<void> {
  const store = createInstallationStore(db);
  const stored: readonly [TenantIds, Partial<InstallationUpsert>][] = [
    [TENANT.admitted, {}],
    [TENANT.rejected, { admission: rejection }],
    [TENANT.suspended, { suspendedAt: LATER }],
    [TENANT.deleted, { deletedAt: LATER }],
    [TENANT.other, {}],
  ];
  for (const [ids, overrides] of stored) {
    const row = await store.upsertInstallation(installationOf(ids, overrides));
    await store.upsertRepositories(row.id, [
      { githubRepoId: parseGithubId(ids.repository), fullName: `account-${ids.installation}/repo` },
    ]);
  }
}

/** A migrated PGlite holding {@link TENANT}. The caller closes it, or hands it to the app, which does. */
export async function tenantDatabase(): Promise<Kysely<Database>> {
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  await seedTenants(db);
  return db;
}

/** A database handle that counts the statements sent through it, and the statements: for the tests of what a request reads. */
export function countingDatabase(db: Kysely<Database>): {
  readonly db: Kysely<Database>;
  readonly statements: string[];
} {
  const statements: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }) => {
      statements.push(node.kind);
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return { db: db.withPlugin(plugin), statements };
}
