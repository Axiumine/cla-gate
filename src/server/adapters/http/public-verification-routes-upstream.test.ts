// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { twoTenants } from '../db/tenant-fixture/test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { parsed } from './document-fixture/test-support.ts';
import { LOGINS, lookups, publicWorld, signedOf } from './public-verification-fixture/test-support.ts';

// GitHub and the memory of the logins in GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): a login is looked up with the token of the
// installation that holds the repository and remembered for ten minutes, a miss as well as a hit; a lookup GitHub cannot answer (403, 429,
// 5xx, an answer that is not an account, a refused token) is `503 upstream_unavailable` with `Retry-After` and is never remembered.

const TEN_MINUTES_MS = 600_000;

test('a login is looked up once in ten minutes, a login nobody has included, and again once they have passed', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (const login of [LOGINS.signer1, 'OctoCat', 'nobody-has-this', 'NOBODY-HAS-THIS', LOGINS.signer1]) {
    await world.verify(repository, login);
  }
  expect(lookups(world)).toBe(2);
  world.clock.advance(TEN_MINUTES_MS - 1000);
  await world.verify(repository, LOGINS.signer1);
  await world.verify(repository, 'nobody-has-this');
  expect(lookups(world)).toBe(2);
  world.clock.advance(2000);
  await world.verify(repository, LOGINS.signer1);
  await world.verify(repository, 'nobody-has-this');
  expect(lookups(world)).toBe(4);
});

test('a login that was renamed on GitHub is followed once the memory of it has passed: the new id decides', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  expect(signedOf(await world.verify(repository, LOGINS.signer1))).toBe(true);
  world.fakeGitHub.scriptUserAccount(LOGINS.signer1, {
    id: parseGithubId(7_000_009),
    login: LOGINS.signer1,
    type: 'User',
  });
  expect(signedOf(await world.verify(repository, LOGINS.signer1))).toBe(true);
  world.clock.advance(TEN_MINUTES_MS + 1000);
  expect(signedOf(await world.verify(repository, LOGINS.signer1))).toBe(false);
});

test('the login is looked up with the token of the installation that holds the repository', async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
  await world.verify(t2.plain.githubRepoId, LOGINS.signer2);
  expect(world.fakeGitHub.calls).toEqual([
    { method: 'getUserAccount', installationId: t1.githubInstallationId },
    { method: 'getUserAccount', installationId: t2.githubInstallationId },
  ]);
});

/** What GitHub does to a lookup, and the seconds the client is told to wait. */
const FAILURES = [
  ['a 403', new GitHubForbiddenError('GET /users/{username}'), '30'],
  ['a 429 that names a wait', new GitHubRateLimitedError(120, 'secondary'), '120'],
  ['a 429 that names a day', new GitHubRateLimitedError(86_400, 'primary'), '300'],
  ['a 5xx', new GitHubUnavailableError('GitHub answered 502 to GET /users/{username}'), '30'],
  ['an answer that is not an account', new GitHubResponseError('GET /users/{username}', ['id']), '30'],
  ['a refused token', new GitHubAuthError(), '30'],
] as const;

test('GitHub failing is 503 upstream_unavailable with Retry-After, readable by any site and kept by no cache: a 403, a 429, a 5xx, a bad answer, a refused token', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (const [name, error, wait] of FAILURES) {
    world.fakeGitHub.failNext('getUserAccount', error);
    const response = await world.verify(repository, 'flaky-login');
    expect(response.statusCode, name).toBe(503);
    expect(parsed(response, errorResponseSchema).error.code, name).toBe('upstream_unavailable');
    expect(response.headers['retry-after'], name).toBe(wait);
    expect(response.headers['cache-control'], name).toBe('no-store');
    expect(response.headers['access-control-allow-origin'], name).toBe('*');
    expect(response.headers['set-cookie'], name).toBeUndefined();
  }
});

test('a failure is not remembered, and neither a miss nor a hit is spoiled by it: the next call asks GitHub again and answers', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  world.fakeGitHub.failNext(
    'getUserAccount',
    new GitHubUnavailableError('GitHub answered 500 to GET /users/{username}'),
  );
  expect((await world.verify(repository, LOGINS.signer1)).statusCode).toBe(503);
  const answer = await world.verify(repository, LOGINS.signer1);
  expect([answer.statusCode, answer.body]).toEqual([200, '{"signed":true}']);
  world.fakeGitHub.failNext(
    'getUserAccount',
    new GitHubUnavailableError('GitHub answered 500 to GET /users/{username}'),
  );
  expect(signedOf(await world.verify(repository, LOGINS.signer1))).toBe(true);
  expect(lookups(world)).toBe(2);
});

test('a failure of the lookup names nothing of the login or of GitHub in the answer', async () => {
  const world = await publicWorld();
  world.fakeGitHub.failNext(
    'getUserAccount',
    new GitHubUnavailableError('GitHub answered 500 to GET /users/zzzz-leak'),
  );
  const response = await world.verify(world.t1.plain.githubRepoId, 'zzzz-leak');
  expect(response.statusCode).toBe(503);
  expect(response.body).not.toContain('zzzz');
  expect(response.body).not.toContain('GitHub');
});

test('the repository is checked before GitHub is asked: a repository that may not be asked about is 404 while GitHub is down', async () => {
  const world = await publicWorld();
  world.fakeGitHub.failNext(
    'getUserAccount',
    new GitHubUnavailableError('GitHub answered 500 to GET /users/{username}'),
  );
  const response = await world.verify(987_654, LOGINS.signer1);
  expect(response.statusCode).toBe(404);
  expect(lookups(world)).toBe(0);
});

test('a server with no GitHub App cannot look a login up: 503 upstream_unavailable with Retry-After, and 404 where no lookup is needed', async () => {
  const world = await authWorld();
  const { t1 } = await twoTenants(world.db);
  await world.db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: t1.documentId, public_verification: true })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const asked = await world.app.inject({ url: `/api/public/repos/${t1.plain.githubRepoId}/signers/octocat` });
  expect([asked.statusCode, asked.headers['retry-after']]).toEqual([503, '30']);
  expect(parsed(asked, errorResponseSchema).error.code).toBe('upstream_unavailable');
  const unknown = await world.app.inject({ url: '/api/public/repos/987654/signers/octocat' });
  expect(unknown.statusCode).toBe(404);
});
