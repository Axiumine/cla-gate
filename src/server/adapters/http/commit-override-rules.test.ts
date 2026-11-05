// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commit, commitSha } from '../../services/github-pull-contract/test-support.ts';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from '../../services/ports/github-errors.ts';
import {
  bodyOf,
  COMMIT,
  lookups,
  overrideWorld,
  REASON,
  recordAs,
  recordWith,
  SEEDED_COMMIT,
  storedOverrides,
} from './commit-override-fixture/test-support.ts';
import { auditRows, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { pointAt, setEnabled, suspendTenantOne } from './repository-document-fixture/test-support.ts';

// The rules that refuse `POST /api/repositories/:repositoryId/commit-overrides` (E15-S05): the role, the shape of the body, the commit id
// and the reason, a repository that is off, a commit GitHub does not show, GitHub failing, an override that exists, and a tenant that is
// away. Every refusal leaves every tenant table as it was, writes no audit row and sends no job.

type World = Awaited<ReturnType<typeof overrideWorld>>;

/** Records `body` as `who` in the repository and checks that no tenant table changed, no audit row was written and no job was sent. */
async function refused(world: World, who: Parameters<typeof recordWith>[1], repositoryId: number, body: object) {
  const before = await tablesOf(world);
  const audit = await auditRows(world, 'commit_override.created');
  const jobs = await jobCount(world.db);
  const response = await recordWith(world, who, repositoryId, body);
  expect(await tablesOf(world)).toEqual(before);
  expect(await auditRows(world, 'commit_override.created')).toEqual(audit);
  expect(await jobCount(world.db)).toBe(jobs);
  return response;
}

const outcome = (response: { statusCode: number; json: () => unknown }): [number, string] => [
  response.statusCode,
  errorCodeOf(response),
];

test('a person who is not an admin of the installation or the repository gets the 404 of an unknown repository, byte for byte, and GitHub is not asked', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const unknown = await refused(world, 'admin1', 987_654, bodyOf(COMMIT));
  const answers = [
    await refused(world, 'member1', t1.plain.repositoryId, bodyOf(COMMIT)),
    await refused(world, 'outsider', t1.plain.repositoryId, bodyOf(COMMIT)),
    await refused(world, 'admin2', t1.plain.repositoryId, bodyOf(COMMIT)),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(lookups(world)).toEqual([]);
});

test('without a session the call is 401, and without the origin and the token 403, before anything else', async () => {
  const world = await overrideWorld();
  const none = await world.ask(null, {
    method: 'POST',
    url: `/api/repositories/${world.t1.plain.repositoryId}/commit-overrides`,
    payload: bodyOf(COMMIT),
  });
  const noToken = await world.app.inject({
    method: 'POST',
    url: `/api/repositories/${world.t1.plain.repositoryId}/commit-overrides`,
    payload: bodyOf(COMMIT),
  });
  expect([none.statusCode, noToken.statusCode]).toEqual([401, 403]);
  expect(await storedOverrides(world)).toEqual([]);
  expect(lookups(world)).toEqual([]);
});

test("the admin of a repository whose document is the organisation's is 403 forbidden, and so is the admin of another repository, before the body is read", async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const plain = await refused(world, 'repoAdmin1', t1.plain.repositoryId, { zzzz: 'not a body' });
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  const scoped = await refused(world, 'repoAdmin1', t1.scoped.repositoryId, bodyOf('abc', ''));
  expect([outcome(plain), outcome(scoped)]).toEqual([
    [403, 'forbidden'],
    [403, 'forbidden'],
  ]);
  expect(lookups(world)).toEqual([]);
  const org = await recordAs(world, 'admin1', t1.scoped.repositoryId, COMMIT);
  expect(org.statusCode).toBe(201);
});

test('the role decides what a person learns: the admin of a repository with no document is told 403 and not that it is off or has no CLA', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, null);
  await setEnabled(world, t1.scoped.repositoryId, false);
  const response = await refused(world, 'repoAdmin1', t1.scoped.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([403, 'forbidden']);
});

test.each([
  ['no body fields', {}],
  ['no reason', { commitSha: COMMIT }],
  ['no commit', { reason: REASON }],
  ['a key nobody defined', { ...bodyOf(COMMIT), installationId: 1 }],
  ['a repository in the body', { ...bodyOf(COMMIT), repositoryId: 1 }],
  ['a commit that is not text', { commitSha: 7, reason: REASON }],
  ['a reason that is not text', { commitSha: COMMIT, reason: null }],
  ['a list for a body', [bodyOf(COMMIT)]],
])('%s is 400 bad_request, GitHub is not asked, and nothing changes', async (_name, body) => {
  const world = await overrideWorld();
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, body);
  expect(outcome(response)).toEqual([400, 'bad_request']);
  expect(lookups(world)).toEqual([]);
});

test.each([
  ['an abbreviated id', COMMIT.slice(0, 7)],
  ['an id of 39 characters', COMMIT.slice(0, 39)],
  ['an id of 41 characters', `${COMMIT}7`],
  ['an id of 63 characters', COMMIT.repeat(2).slice(0, 63)],
  ['an id of 65 characters', `${COMMIT.repeat(2).slice(0, 64)}7`],
  ['a branch name', 'main'],
  ['a revision expression', `${COMMIT}~1`],
  ['an empty string', ''],
  ['an id with a space around it', ` ${COMMIT}`],
  ['an id with a line feed after it', `${COMMIT}\n`],
  ['an id with a character that is not hexadecimal', `${COMMIT.slice(0, 39)}g`],
  ['an id with a full-width letter', `${COMMIT.slice(0, 39)}ａ`],
])('%s is 422 invalid_commit_sha, GitHub is not asked, and nothing changes', async (_name, typed) => {
  const world = await overrideWorld();
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(typed));
  expect(outcome(response)).toEqual([422, 'invalid_commit_sha']);
  expect(lookups(world)).toEqual([]);
});

test.each([
  ['an empty reason', ''],
  ['a reason of spaces', '   '],
  ['a reason of white space and line breaks', ' \n\t\r\n '],
  ['a reason of 2,001 characters', 'a'.repeat(2001)],
  ['a reason with a control character', 'before\u0000after'],
  ['a reason with an escape character', 'before\u001b[31mafter'],
  ['a reason with a lone surrogate', 'before\ud800after'],
])('%s is 422 invalid_reason, GitHub is not asked, and nothing changes', async (_name, reason) => {
  const world = await overrideWorld();
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT, reason));
  expect(outcome(response)).toEqual([422, 'invalid_reason']);
  expect(lookups(world)).toEqual([]);
});

test('a request with both a bad commit id and a bad reason is told about the commit id first', async () => {
  const world = await overrideWorld();
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf('abc', ''));
  expect(outcome(response)).toEqual([422, 'invalid_commit_sha']);
});

test('a repository that is off is 409 repository_disabled, GitHub is not asked, and a bad body is told first', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await setEnabled(world, t1.plain.repositoryId, false);
  const off = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(COMMIT));
  const bad = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf('abc'));
  expect([outcome(off), outcome(bad)]).toEqual([
    [409, 'repository_disabled'],
    [422, 'invalid_commit_sha'],
  ]);
  expect(lookups(world)).toEqual([]);
  await setEnabled(world, t1.plain.repositoryId, true);
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
});

test('a repository that GitHub no longer lists is the 404 of an unknown one', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const response = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(COMMIT));
  expect(response.statusCode).toBe(404);
  expect(lookups(world)).toEqual([]);
});

test('a suspended installation is 409 installation_suspended, also for the org admin the ledger remembers, and GitHub is not asked', async () => {
  const world = await overrideWorld();
  await suspendTenantOne(world);
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([409, 'installation_suspended']);
  expect(lookups(world)).toEqual([]);
});

test('a commit GitHub does not show in the repository is 422 commit_not_found, also when another repository of the installation has it', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const elsewhere = commitSha(0x5a5a5a);
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.scoped.fullName, [commit(0x5a5a5a)]);
  const unknown = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(commitSha(0xfeed)));
  const other = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(elsewhere));
  expect([outcome(unknown), outcome(other)]).toEqual([
    [422, 'commit_not_found'],
    [422, 'commit_not_found'],
  ]);
  const own = await recordAs(world, 'admin1', t1.scoped.repositoryId, elsewhere);
  expect(own.statusCode).toBe(201);
});

test.each([
  ['a 404', () => new GitHubNotFoundError('GET /repos/zzzz-secret/commits/zzzz')],
  ['a 422', () => new GitHubUnprocessableError('GET /repos/zzzz-secret/commits/zzzz')],
])('GitHub answering %s is 422 commit_not_found, with nothing GitHub sent in the message', async (_name, error) => {
  const world = await overrideWorld();
  world.fakeGitHub.failNext('getCommit', error());
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([422, 'commit_not_found']);
  expect(response.body).not.toContain('zzzz');
});

test('a rate limit on the lookup is 503 github_rate_limited with the wait GitHub asked for, and nothing is stored', async () => {
  const world = await overrideWorld();
  world.fakeGitHub.failNext('getCommit', new GitHubRateLimitedError(120, 'primary'));
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([503, 'github_rate_limited']);
  expect(response.headers['retry-after']).toBe('120');
});

test('an outage of GitHub is 502 github_unavailable with no wait, and a retry after it came back succeeds', async () => {
  const world = await overrideWorld();
  world.fakeGitHub.failNext('getCommit', new GitHubUnavailableError('GET /repos/zzzz-secret/commits/zzzz'));
  const failed = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(failed)).toEqual([502, 'github_unavailable']);
  expect(failed.headers['retry-after']).toBeUndefined();
  expect(failed.body).not.toContain('zzzz');
  const retried = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect(retried.statusCode).toBe(201);
});

test.each([
  ['a refusal of the token', () => new GitHubForbiddenError('GET /repos/zzzz-secret/commits/zzzz')],
  [
    'an answer that is not a commit',
    () => new GitHubResponseError('GET /repos/{owner}/{repo}/commits/{ref}', ['zzzz-secret']),
  ],
  ['an unexpected error', () => new Error('zzzz-secret token expired')],
])('%s is 502 github_unavailable too, with fixed text', async (_name, error) => {
  const world = await overrideWorld();
  world.fakeGitHub.failNext('getCommit', error());
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([502, 'github_unavailable']);
  expect(response.body).not.toContain('zzzz');
});

test('a server built with no GitHub App answers 502 github_unavailable and stores nothing', async () => {
  const world = await overrideWorld({ commitGitHub: undefined });
  const response = await refused(world, 'admin1', world.t1.plain.repositoryId, bodyOf(COMMIT));
  expect(outcome(response)).toEqual([502, 'github_unavailable']);
  expect(lookups(world)).toEqual([]);
});

test('a commit that carries an override already is 409 override_exists, and the first row, its author and its reason stay', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const first = await recordWith(world, 'admin1', t1.plain.repositoryId, bodyOf(COMMIT, 'the first reason'));
  const [stored] = await storedOverrides(world);
  const again = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(COMMIT.toUpperCase(), 'another reason'));
  expect([first.statusCode, outcome(again)]).toEqual([201, [409, 'override_exists']]);
  expect(await storedOverrides(world)).toEqual([stored]);
  expect(stored).toMatchObject({ reason: 'the first reason', created_by: people.admin1.userId });
});

test('the override the world stores is found as well: its commit is 409 override_exists', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [
    commit(7, { sha: SEEDED_COMMIT }),
  ]);
  const response = await refused(world, 'admin1', t1.plain.repositoryId, bodyOf(SEEDED_COMMIT));
  expect(outcome(response)).toEqual([409, 'override_exists']);
});
