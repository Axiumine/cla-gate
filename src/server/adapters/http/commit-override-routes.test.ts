// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { commit, commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  bodyOf,
  COMMIT,
  lookups,
  overrideOf,
  overrideWorld,
  REASON,
  recordAs,
  recordWith,
  storedOverrides,
} from './commit-override-fixture/test-support.ts';
import { auditRows } from './document-fixture/test-support.ts';

// POST /api/repositories/:repositoryId/commit-overrides (E15-S05): what recording an override stores, answers and audits, on the real
// application over PGlite with the fake GitHub behind the lookup of the commit. The refusals are in commit-override-rules.test.ts, the
// jobs in commit-override-jobs.test.ts, the other tenant's ids in commit-override-tenants.test.ts, the effect on a pull request in
// commit-override-flow.test.ts.

test('the org admin records an override: 201, no-store, the override as stored with its author by numeric id, and nothing else in the answer', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const [stored] = await storedOverrides(world);
  expect(stored).toMatchObject({
    installation_id: t1.installationId,
    repository_id: t1.plain.repositoryId,
    commit_sha: COMMIT,
    reason: REASON,
    created_by: people.admin1.userId,
  });
  expect(overrideOf(response)).toEqual({
    id: stored?.id,
    repositoryId: t1.plain.repositoryId,
    commitSha: COMMIT,
    reason: REASON,
    createdBy: { githubId: people.admin1.githubId, login: people.admin1.login },
    createdAt: stored?.created_at.toISOString(),
  });
  const sent = z.object({ override: z.record(z.string(), z.json()) }).parse(response.json());
  expect(Object.keys(sent)).toEqual(['override']);
  expect(Object.keys(sent.override).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'commitSha',
    'createdAt',
    'createdBy',
    'id',
    'reason',
    'repositoryId',
  ]);
});

test('the admin of a repository records one for the repository whose document is its own, and the row names that person', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const response = await recordAs(world, 'repoAdmin1', t1.scoped.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  expect(await storedOverrides(world)).toMatchObject([
    { repository_id: t1.scoped.repositoryId, created_by: people.repoAdmin1.userId },
  ]);
  expect(overrideOf(response).createdBy).toEqual({
    githubId: people.repoAdmin1.githubId,
    login: people.repoAdmin1.login,
  });
});

test.each([
  ['upper case', (sha: string) => sha.toUpperCase()],
  ['mixed case', (sha: string) => `${sha.slice(0, 36).toUpperCase()}${sha.slice(36)}`],
])('a commit id in %s is looked up, stored and answered in lower case', async (_name, typed) => {
  const world = await overrideWorld();
  const { t1 } = world;
  const lower = commitSha(0xabcdef);
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [commit(0xabcdef)]);
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, typed(lower));
  expect(response.statusCode).toBe(201);
  expect(overrideOf(response).commitSha).toBe(lower);
  expect((await storedOverrides(world)).map((row) => row.commit_sha)).toEqual([lower]);
  expect(await auditRows(world, 'commit_override.created')).toMatchObject([{ metadata: { commit_sha: lower } }]);
});

test('a 64-character id (SHA-256) is recorded like a 40-character one', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const long = '0123456789abcdef'.repeat(4);
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [commit(5, { sha: long })]);
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, long.toUpperCase());
  expect([response.statusCode, overrideOf(response).commitSha]).toEqual([201, long]);
});

test('the reason is stored trimmed with line feeds for line endings, and a hostile text is kept exactly as sent: every output escapes it', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const hostile = [
    '<script>alert("zzzz")</script>',
    '=HYPERLINK("https://zzzz.example/","click")',
    '@everyone [x](javascript:zzzz) `code`',
    "'; drop table commit_overrides; --",
    'line one\r\nline two\rline three',
  ];
  for (const [index, text] of hostile.entries()) {
    world.fakeGitHub.setRepositoryCommits(
      t1.githubInstallationId,
      t1.plain.fullName,
      hostile.map((_text, number) => commit(100 + number)),
    );
    const response = await recordWith(
      world,
      'admin1',
      t1.plain.repositoryId,
      bodyOf(commitSha(100 + index), `  ${text}\n\t `),
    );
    expect(response.statusCode).toBe(201);
    const wanted = text.replaceAll(/\r\n?/g, '\n');
    expect(overrideOf(response).reason).toBe(wanted);
  }
  expect((await storedOverrides(world)).map((row) => row.reason)).toEqual(
    hostile.map((text) => text.replaceAll(/\r\n?/g, '\n')),
  );
});

test('a reason of 2,000 characters is recorded, and a reason of 2,000 code points that take two units each as well', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [commit(1), commit(2)]);
  const plain = await recordWith(world, 'admin1', t1.plain.repositoryId, bodyOf(commitSha(1), 'a'.repeat(2000)));
  const astral = await recordWith(
    world,
    'admin1',
    t1.plain.repositoryId,
    bodyOf(commitSha(2), '\u{1F600}'.repeat(2000)),
  );
  expect([plain.statusCode, astral.statusCode]).toEqual([201, 201]);
  expect(Array.from(overrideOf(astral).reason)).toHaveLength(2000);
});

test('one audit row commit_override.created is written for the tenant: the actor by numeric id, the override as the subject, and the repository and the commit as metadata, never the reason', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const response = await recordWith(
    world,
    'admin1',
    t1.plain.repositoryId,
    bodyOf(COMMIT, 'zzzz-private-note about the author'),
  );
  const { id } = overrideOf(response);
  const rows = await auditRows(world, 'commit_override.created');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'commit_override',
    subject_id: id,
    metadata: { repository_id: t1.plain.repositoryId, commit_sha: COMMIT },
  });
  expect(Object.keys(rows[0]?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'commit_sha',
    'repository_id',
  ]);
  expect(JSON.stringify(rows)).not.toContain('zzzz-private-note');
  expect(JSON.stringify(rows)).not.toContain(people.admin1.login);
});

test('an override is not a signature: no signature and no personal data row is written, changed or removed', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const snapshot = async () => ({
    signatures: await world.db.selectFrom('signatures').selectAll().orderBy('id').execute(),
    signerPii: await world.db.selectFrom('signer_pii').selectAll().orderBy('signature_id').execute(),
  });
  const before = await snapshot();
  expect(before.signatures.length).toBeGreaterThan(0);
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  expect(await snapshot()).toEqual(before);
});

test('the commit is asked of GitHub once, for the installation of the repository, before anything is stored', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
  expect(lookups(world)).toEqual([{ method: 'getCommit', installationId: t1.githubInstallationId }]);
});

test('the commit is looked up under the name the repository has now: a renamed repository is asked for by its new name', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ full_name: 'org-1/renamed' })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const missing = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, 'org-1/renamed', [commit(7, { sha: COMMIT })]);
  const found = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect([missing.statusCode, found.statusCode]).toEqual([422, 201]);
});

test('the same commit can be overridden in two repositories of one tenant, each once', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const first = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  const second = await recordAs(world, 'admin1', t1.scoped.repositoryId, COMMIT);
  expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
  expect((await storedOverrides(world)).map((row) => row.repository_id)).toEqual([
    t1.plain.repositoryId,
    t1.scoped.repositoryId,
  ]);
});
