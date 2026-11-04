// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { rowId } from '../adapters/db/test-support.ts';
import { createAllowlistEntry } from './allowlist-entry-create.ts';
import type { AllowlistDeps, NewAllowlistEntry } from './allowlist-entry-types.ts';
import { jobCount } from './jobs-fixture/test-support.ts';
import { brokenBy, publishWorld, refuseAudit } from './publish-fixture/test-support.ts';
import { FakeGitHub } from './test-support.ts';

// Adding an allowlist entry below the routes (E14-S06): the checks the service makes itself, which the guard of the route cannot make
// for it because it decides before the lock is held, what the snapshot of a login is, and what an abort leaves.

const MEMBERS = { kind: 'org_members' } as const;

async function world() {
  const base = await publishWorld();
  const { t1 } = base;
  const github = new FakeGitHub();
  const account = { id: t1.accountId, login: t1.accountLogin, type: 'Organization' } as const;
  github.addInstallation({ id: t1.githubInstallationId, account, suspendedAt: null, permissions: {} });
  const deps: AllowlistDeps = { db: base.db, github, enqueuer: base.enqueuer };
  /** An add by an org admin of tenant 1 for the installation, unless `over` says otherwise. */
  const request = (over: Partial<NewAllowlistEntry>): NewAllowlistEntry => ({
    target: { scope: 'installation' },
    role: 'org_admin',
    actor: base.admin,
    entry: MEMBERS,
    ...over,
  });
  const run = (over: Partial<NewAllowlistEntry> = {}) => createAllowlistEntry(deps, base.scope, request(over));
  /** The entries the tests added: every row but the ones the world seeds (GitHub ids 100, 101, 200 and 201). */
  const stored = () =>
    base.db
      .selectFrom('allowlist_entries')
      .select(['github_id', 'login_snapshot', 'created_by'])
      .where('github_id', 'not in', [100, 101, 200, 201])
      .execute();
  return { ...base, github, run, stored };
}

test('an admin of a repository is refused an entry for the installation, before GitHub is asked', async () => {
  const { run, github, stored } = await world();
  const refused = await brokenBy(run({ role: 'repo_admin' }));
  expect(refused).toEqual({ rule: 'forbidden', details: undefined });
  expect(github.calls).toEqual([]);
  expect(await stored()).toEqual([]);
});

test("an admin of a repository whom the guard let in is refused when the document attached by the time the lock is held is the organisation's", async () => {
  const { t1, db, run, github } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await brokenBy(
    run({ target: { scope: 'repository', repositoryId: t1.scoped.repositoryId }, role: 'repo_admin' }),
  );
  expect(refused).toEqual({ rule: 'forbidden', details: undefined });
  expect(github.calls).toEqual([]);
});

test('the admin of a repository whose own document is attached is let in for that repository', async () => {
  const { t1, db, run } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.scoped.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const entry = await run({
    target: { scope: 'repository', repositoryId: t1.scoped.repositoryId },
    role: 'repo_admin',
  });
  expect([entry.scope, entry.repositoryId]).toEqual(['repository', t1.scoped.repositoryId]);
});

test("a repository that is not in the tenant, or does not exist, is not_found, whatever the role: the other tenant's repository is not seen", async () => {
  const { t2, run, stored } = await world();
  const crossed = await brokenBy(run({ target: { scope: 'repository', repositoryId: t2.plain.repositoryId } }));
  const missing = await brokenBy(run({ target: { scope: 'repository', repositoryId: 987_654 } }));
  expect([crossed, missing]).toEqual([
    { rule: 'not_found', details: undefined },
    { rule: 'not_found', details: undefined },
  ]);
  expect(await stored()).toEqual([]);
});

test('a tenant that is gone is not_found, and GitHub is not asked', async () => {
  const { db, github, enqueuer } = await world();
  const refused = await brokenBy(
    createAllowlistEntry(
      { db, github, enqueuer },
      { installationId: rowId(987_654) },
      {
        target: { scope: 'installation' },
        role: 'org_admin',
        actor: { id: 1, githubId: parseGithubId(31_001) },
        entry: MEMBERS,
      },
    ),
  );
  expect(refused).toEqual({ rule: 'not_found', details: undefined });
  expect(github.calls).toEqual([]);
});

test('the entry of the members is the installation: the id of the account and its login as the display snapshot, by the author', async () => {
  const { t1, run, stored, admin } = await world();
  const entry = await run();
  expect(entry).toMatchObject({ kind: 'org_members', githubId: t1.accountId, loginSnapshot: t1.accountLogin });
  expect(await stored()).toEqual([{ github_id: t1.accountId, login_snapshot: t1.accountLogin, created_by: admin.id }]);
});

test('a login that is not the shape of a login is not kept as the snapshot: the entry is stored with none, by its id', async () => {
  const { t1, db, run, stored, admin } = await world();
  await db
    .updateTable('installations')
    .set({ account_login: 'not a login!' })
    .where('id', '=', t1.installationId)
    .execute();
  const entry = await run();
  expect([entry.githubId, entry.loginSnapshot]).toEqual([t1.accountId, null]);
  expect(await stored()).toEqual([{ github_id: t1.accountId, login_snapshot: null, created_by: admin.id }]);
});

test('a refused audit row undoes the entry and its sweeps with it', async () => {
  const { db, run, stored } = await world();
  await refuseAudit(db);
  await expect(run()).rejects.toThrow('audit refused');
  expect(await stored()).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('a duplicate is allowlist_entry_exists and stores no second row and sends no job', async () => {
  const { run, stored, db } = await world();
  await run();
  const jobs = await jobCount(db);
  const refused = await brokenBy(run());
  expect(refused).toEqual({ rule: 'allowlist_entry_exists', details: undefined });
  expect(await stored()).toHaveLength(1);
  expect(await jobCount(db)).toBe(jobs);
});
