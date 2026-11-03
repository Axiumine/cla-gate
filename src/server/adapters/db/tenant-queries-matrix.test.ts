// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { tenantChecksums, twoTenants } from './tenant-fixture/test-support.ts';
import { attempt, type ScopedQuery, TENANT_QUERIES, type TenantQuery } from './tenant-registry/test-support.ts';
import { migratedTestDatabase } from './test-support.ts';

// The cross-tenant matrix of the data access (E11-S06), generated from TENANT_QUERIES: every function that takes the tenant
// is called for tenant 1 with tenant 1's ids, for tenant 1 with tenant 2's ids, and once every repository of tenant 1 is
// removed. The database holds two tenants with rows in every tenant table (`twoTenants`), so a statement that strays has
// something to read or change. It runs on PGlite, and on a real Postgres when DATABASE_URL is set.

const scoped: (readonly [string, ScopedQuery])[] = Object.entries(TENANT_QUERIES).flatMap(([file, queries]) =>
  Object.entries(queries).flatMap(([name, query]) =>
    query.kind === 'scoped' ? [[`${file} ${name}`, query] as const] : [],
  ),
);
/** `expect.arrayContaining` is typed `any`; as `unknown` it can sit in an object literal. */
const containingOwner = (owner: number): unknown => expect.arrayContaining([owner]);

const byIds = scoped.filter(([, query]) => query.takesIds);

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  return { db, ...tenants };
}

test('the registry holds the scoped queries the story lists, so the matrix below is not empty', () => {
  expect(scoped.map(([name]) => name)).toEqual([
    'adapters/db/tenant-scope.ts assertRepositoryInTenant',
    'services/admin-ledger-queries.ts recordAdminSeen',
    'services/admin-ledger-queries.ts forgetAdminSeen',
    'services/admin-ledger-queries.ts wasAdminSeenSince',
    'services/cla-document-queries.ts findDocument',
    'services/cla-document-queries.ts listDocuments',
    'services/cla-document-queries.ts listRepositoryDocuments',
    'services/cla-document-writes.ts countDocuments',
    'services/cla-document-writes.ts insertDocument',
    'services/cla-document-writes.ts updateDocumentName',
    'services/document-placement.ts findDocumentPlacement',
    'services/document-placement.ts findSignaturePlacement',
    'services/repo-admin-candidates.ts listRepoAdminCandidates',
    'services/repository-enabled.ts setRepositoryEnabled',
    'services/repository-queries.ts markRepositoriesRemoved',
    'services/repository-queries.ts renameActiveRepository',
    'services/repository-queries.ts findActiveRepositoryByGithubId',
    'services/repository-queries.ts findRepositoryByGithubId',
    'services/repository-queries.ts listActiveRepositoryIds',
    'services/repository-queries.ts listEnabledRepositories',
    'services/repository-statements.ts storedStates',
    'services/repository-statements.ts writeChanged',
    'services/tenant-queries.ts findTenantRows',
    'services/tenant-queries.ts findAdmittedTenantRows',
    'services/close-pr/close-heads.ts headShasToCancel',
    'services/close-pr/close-rows.ts evaluationsOfPullRequest',
    'services/close-pr/close-rows.ts cancelEvaluation',
    'services/evaluate-pr/evaluation-rows.ts findEvaluation',
    'services/evaluate-pr/evaluation-rows.ts startEvaluation',
    'services/evaluate-pr/evaluation-rows.ts finishEvaluation',
    'services/evaluate-pr/evaluation-rows.ts failEvaluation',
    'services/evaluate-pr/evaluation-rows.ts evaluationsAtHead',
    'services/evaluate-pr/policy-facts.ts readPolicy',
    'services/evaluate-pr/policy-facts.ts readAllowlist',
    'services/evaluate-pr/policy-facts.ts readOverrides',
    'services/evaluate-pr/signature-facts.ts readSignatures',
    'services/sweep/sweep-rows.ts evaluationStates',
    'services/sweep/sweep-rows.ts staleEvaluations',
  ]);
});

test.each(scoped)(
  "%s: called for a tenant with that tenant's ids it answers with the rows of that tenant only",
  async (_name, query) => {
    const { db, t1, t2 } = await world();
    const first = await attempt(query, db, { installationId: t1.installationId }, t1);
    expect(first).toEqual({ kind: 'rows', owners: containingOwner(t1.installationId) });
    expect(first.kind === 'rows' ? first.owners.filter((owner) => owner !== t1.installationId) : []).toEqual([]);
    const second = await attempt(query, db, { installationId: t2.installationId }, t2);
    expect(second).toEqual({ kind: 'rows', owners: containingOwner(t2.installationId) });
    expect(second.kind === 'rows' ? second.owners.filter((owner) => owner !== t2.installationId) : []).toEqual([]);
  },
);

test.each(byIds)(
  '%s: called for tenant 1 with the ids of tenant 2 it answers nothing, or refuses, and changes nothing',
  async (_name, query) => {
    const { db, t1, t2 } = await world();
    const before = await tenantChecksums(db);
    const outcome = await attempt(query, db, { installationId: t1.installationId }, t2);
    expect(outcome).toEqual(query.refusal === undefined ? { kind: 'rows', owners: [] } : { kind: 'refused' });
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

test.each(scoped.filter(([, query]) => query.activeOnly))(
  '%s: with every repository of the tenant removed it finds nothing, or refuses, and changes nothing',
  async (_name, query) => {
    const { db, t1 } = await world();
    await db
      .updateTable('repositories')
      .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
      .where('installation_id', '=', t1.installationId)
      .execute();
    const before = await tenantChecksums(db);
    const outcome = await attempt(query, db, { installationId: t1.installationId }, t1);
    expect(outcome).toEqual(query.refusal === undefined ? { kind: 'rows', owners: [] } : { kind: 'refused' });
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

const byDesign = Object.entries(TENANT_QUERIES).flatMap(([file, queries]) =>
  Object.entries(queries).flatMap(([name, query]) =>
    query.kind === 'by_design' ? [[`${file} ${name}`, query] as const] : [],
  ),
);

test.each(byDesign)(
  '%s: a function that meets another tenant by design answers what it says it does, for the tenant and for another',
  async (_name, query) => {
    const { db, t1, t2 } = await world();
    const scope = { installationId: t1.installationId };
    const own = await query.run(db, scope, t1);
    const foreign = await query.run(db, scope, t2);
    expect({ own, foreign }).toEqual(query.answers(t1, t2));
  },
);

test('every query of the registry is scoped or by design, so none escapes the two tests above', () => {
  const kinds = Object.values(TENANT_QUERIES).flatMap((queries) =>
    Object.values(queries).map((query: TenantQuery) => query.kind),
  );
  expect(kinds).toHaveLength(scoped.length + byDesign.length);
});
