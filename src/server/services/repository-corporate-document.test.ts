// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishCorporateDocument } from '../adapters/db/corporate-fixture/test-support.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import { createJobsTable, fakeEnqueuer } from './jobs-fixture/test-support.ts';
import { changeCorporateDocument } from './repository-corporate-document.ts';

// The choice of the corporate CLA of a repository below the route (E21-S02), for the case the route's guard cannot show: the repository
// was there when the guard read it and is not the tenant's by the time the lock is taken.

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  await createJobsTable(db);
  const document = await publishCorporateDocument(db, tenants.t1);
  return { db, deps: { db, enqueuer: fakeEnqueuer() }, ...tenants, document, actor: tenants.people.admin1.githubId };
}

/** The rule a change broke, or `null` when it did not break one. */
async function ruleOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    if (error instanceof CorporateRuleError) {
      return error.rule;
    }
    throw error;
  }
}

test('a repository that is not the tenant’s, or is not there, is not_found, and nothing is written', async () => {
  const { db, deps, t1, t2, document, actor } = await world();
  const before = await db.selectFrom('audit_log').select('id').execute();
  for (const repositoryId of [987_654, t2.plain.repositoryId]) {
    const change = { repositoryId, actorGithubId: actor, documentId: document.documentId };
    expect(await ruleOf(changeCorporateDocument(deps, { installationId: t1.installationId }, change))).toBe(
      'not_found',
    );
  }
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual(before);
});

test('a repository of the tenant takes the document, and asking again for it changes nothing', async () => {
  const { deps, t1, document, actor } = await world();
  const change = { repositoryId: t1.plain.repositoryId, actorGithubId: actor, documentId: document.documentId };
  const scope = { installationId: t1.installationId };
  expect(await changeCorporateDocument(deps, scope, change)).toEqual({
    documentId: document.documentId,
    changed: true,
  });
  expect(await changeCorporateDocument(deps, scope, change)).toEqual({
    documentId: document.documentId,
    changed: false,
  });
});
