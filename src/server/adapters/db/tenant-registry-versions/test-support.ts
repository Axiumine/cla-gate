// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import { listEnforcingRepositories } from '../../../services/cla-enforcing-queries.ts';
import { findVersion, listVersions } from '../../../services/cla-history-queries.ts';
import { countSignaturesAtMajor, findActiveVersion, lockDocument } from '../../../services/cla-version-queries.ts';
import { insertVersion, setActiveVersion } from '../../../services/cla-version-writes.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfDocuments } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';
import { publishVersion as seedVersion, sha256 } from '../test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for the statements that publish a version of a CLA document
// (E12-S04), kept in a file of their own so that the registry stays under the size cap. `TENANT_QUERIES` has the reads under
// `services/cla-version-queries.ts`, the read of the enforcing repositories under `services/cla-enforcing-queries.ts` and the writes under
// `services/cla-version-writes.ts`. Every statement is called for a
// tenant with that tenant's ids and with another tenant's, by the generated test of tenant-queries-matrix.test.ts. The world of
// the tests has a signature at major 1 and the version 1.0 on the installation-wide document of each tenant; the two entries that
// need more (a repository that enforces the document, a version 2.0 to point at) arrange it for both tenants first.

/** The text the entry that inserts a version stores. */
const REGISTRY_TEXT = 'Text stored by the registry\n';

/** The installation that owns each version with these row ids, through its document. */
async function ownersOfVersions(db: Kysely<Database>, versionIds: readonly number[]): Promise<number[]> {
  const rows = await db
    .selectFrom('cla_versions as v')
    .innerJoin('cla_documents as d', 'd.id', 'v.document_id')
    .select('d.installation_id')
    .where('v.id', 'in', versionIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each repository stored under these GitHub ids. */
async function ownersOfGithubIds(db: Kysely<Database>, githubRepoIds: readonly number[]): Promise<number[]> {
  const rows = await db
    .selectFrom('repositories')
    .select('installation_id')
    .where('github_repo_id', 'in', githubRepoIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** True for the error of a statement that found no row where the caller has locked one. */
const isNoResult = (error: unknown): boolean => error instanceof NoResultError;

/** Makes the plain repository of each tenant enforce the installation-wide document of that tenant: attached to it and enabled. */
async function enforceDocuments(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await db
      .updateTable('repositories')
      .set({ cla_document_id: tenant.documentId, enabled: true })
      .where('id', '=', tenant.plain.repositoryId)
      .execute();
  }
}

/** Publishes a version 2.0 of the installation-wide document of each tenant, past the service, and leaves the pointer where it is. */
async function addSecondVersions(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await seedVersion(db, tenant.documentId, tenant.publisherId, { major: 2, minor: 0, text: REGISTRY_TEXT });
  }
}

/** The reads of the publish of a version. */
export const VERSION_READS: Readonly<Record<string, ScopedQuery>> = {
  lockDocument: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const locked = await lockDocument(db, scope, ids.documentId);
      return locked === null ? [] : ownersOfDocuments(db, [locked.id]);
    },
  },
  findActiveVersion: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const version = await findActiveVersion(db, scope, ids.documentId);
      return version === null ? [] : ownersOfDocuments(db, [ids.documentId]);
    },
  },
  countSignaturesAtMajor: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      // The signature of the world is at major 1 on the installation-wide document; a count that strayed would find it under the other tenant.
      const count = await countSignaturesAtMajor(db, scope, ids.documentId, 1);
      return count === 0 ? [] : ownersOfDocuments(db, [ids.documentId]);
    },
  },
};

/** The read of the repositories that enforce a document, for the jobs of a major version. */
export const ENFORCING_READS: Readonly<Record<string, ScopedQuery>> = {
  listEnforcingRepositories: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    arrange: (db, tenants) => enforceDocuments(db, tenants),
    run: async (db, scope, ids) => {
      const repositories = await listEnforcingRepositories(db, scope, ids.documentId);
      return repositories.length === 0
        ? []
        : ownersOfGithubIds(
            db,
            repositories.map((repository) => repository.githubRepoId),
          );
    },
  },
};

/** The reads of the history of a document (E12-S05): the versions in order, and one version with its text. The world has version 1.0 on the installation-wide document of each tenant. */
export const HISTORY_READS: Readonly<Record<string, ScopedQuery>> = {
  listVersions: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const versions = await listVersions(db, scope, ids.documentId, { limit: 10, from: null });
      return versions.length === 0
        ? []
        : ownersOfVersions(
            db,
            versions.map((version) => version.id),
          );
    },
  },
  findVersion: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const version = await findVersion(db, scope, ids.documentId, ids.versionId);
      return version === null ? [] : ownersOfVersions(db, [version.id]);
    },
  },
};

/** The writes of the publish of a version. */
export const VERSION_WRITES: Readonly<Record<string, ScopedQuery>> = {
  insertVersion: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    // The row is selected from the document with the installation id in the WHERE clause, so another tenant's document selects none.
    refusal: isNoResult,
    run: async (db, scope, ids) => {
      await insertVersion(db, scope, {
        documentId: ids.documentId,
        major: 3,
        minor: 0,
        contentMd: REGISTRY_TEXT,
        contentSha256: sha256(REGISTRY_TEXT),
        publishedBy: ids.publisherId,
        rationale: 'Stored by the registry',
      });
      return ownersOfDocuments(db, [ids.documentId]);
    },
  },
  setActiveVersion: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    refusal: isNoResult,
    arrange: (db, tenants) => addSecondVersions(db, tenants),
    run: async (db, scope, ids) => {
      const second = await db
        .selectFrom('cla_versions')
        .select('id')
        .where('document_id', '=', ids.documentId)
        .where('major', '=', 2)
        .executeTakeFirstOrThrow();
      await setActiveVersion(db, scope, ids.documentId, second.id);
      return ownersOfDocuments(db, [ids.documentId]);
    },
  },
};
