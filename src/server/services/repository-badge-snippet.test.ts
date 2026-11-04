// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { badgeSnippet } from '../domain/badge-snippet.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { readBadgeSnippet } from './repository-badge-snippet.ts';

// The snippet of the README badge (E22-S03), below the route: the checks in their order. The route tests are in badge-snippet-routes*.test.ts.

const BASE = 'https://cla.example.org';

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const scopeOf = (tenant: { readonly installationId: typeof tenants.t1.installationId }) => ({
    installationId: tenant.installationId,
  });
  const optIn = (repositoryId: number, on = true) =>
    db.updateTable('repositories').set({ public_verification: on }).where('id', '=', repositoryId).execute();
  return { db, scopeOf, optIn, ...tenants };
}

const ask = (
  w: Awaited<ReturnType<typeof world>>,
  repositoryId: number,
  role: 'org_admin' | 'repo_admin' = 'org_admin',
) => readBadgeSnippet(w.db, w.scopeOf(w.t1), { repositoryId, role, publicBaseUrl: BASE });

test('the snippet of an opted-in repository is the Markdown and the HTML of its project badge, on the address it is given', async () => {
  const w = await world();
  await w.optIn(w.t1.plain.repositoryId);
  expect(await ask(w, w.t1.plain.repositoryId)).toEqual(badgeSnippet(BASE, w.t1.plain.githubRepoId));
});

test('while the opt-in is off the rule is public_verification_disabled', async () => {
  const w = await world();
  const error = await ask(w, w.t1.plain.repositoryId).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ClaRuleError);
  expect(error).toMatchObject({ rule: 'public_verification_disabled' });
});

test("a repository the tenant does not have is not_found: unknown, removed, and the other tenant's", async () => {
  const w = await world();
  await w.optIn(w.t1.plain.repositoryId);
  await w.optIn(w.t2.plain.repositoryId);
  await w.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', w.t1.scoped.repositoryId)
    .execute();
  for (const repositoryId of [987_654, w.t2.plain.repositoryId, w.t1.scoped.repositoryId]) {
    expect(await ask(w, repositoryId).catch((caught: unknown) => caught)).toMatchObject({ rule: 'not_found' });
  }
});

test('the role is judged before the opt-in: a repo admin of a repository without a document of its own is forbidden whether the opt-in is on or off', async () => {
  const w = await world();
  for (const on of [false, true]) {
    await w.optIn(w.t1.plain.repositoryId, on);
    expect(await ask(w, w.t1.plain.repositoryId, 'repo_admin').catch((caught: unknown) => caught)).toMatchObject({
      rule: 'forbidden',
    });
  }
});

test('a repo admin may read the snippet of a repository whose own document is attached, and an org admin may read it too', async () => {
  const w = await world();
  await w.db
    .updateTable('repositories')
    .set({ cla_document_id: w.t1.scoped.documentId })
    .where('id', '=', w.t1.scoped.repositoryId)
    .execute();
  await w.optIn(w.t1.scoped.repositoryId);
  const expected = badgeSnippet(BASE, w.t1.scoped.githubRepoId);
  expect(await ask(w, w.t1.scoped.repositoryId, 'repo_admin')).toEqual(expected);
  expect(await ask(w, w.t1.scoped.repositoryId, 'org_admin')).toEqual(expected);
});
