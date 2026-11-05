// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { badgeSvg } from '../../domain/badge-svg.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { parsed, withoutRequestId } from './document-fixture/test-support.ts';
import { LOGINS, lookups, publicWorld } from './public-verification-fixture/test-support.ts';

// The tenants, GitHub and the log of the badges (E22-S03): a signature of one tenant is no signature of the other's repository, a suspended
// installation turns a badge that said "signed" into the 404 of an unknown repository, a lookup GitHub cannot answer is `503
// upstream_unavailable` and no image, the memory of the logins is the JSON call's, and the access log records the route templates.

/** A login that no other test uses and that no answer or log may carry: the marker is not a digit run or a repeated letter. */
const MARKER_LOGIN = 'zzzz-marker-login';

test("a signature of one tenant does not count in the other: each signer's badge is signed for their own tenant's repository only", async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  const signed = badgeSvg('signed');
  const unsigned = badgeSvg('not_signed');
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe(signed);
  expect((await world.signerBadge(t2.plain.githubRepoId, LOGINS.signer2)).body).toBe(signed);
  expect((await world.signerBadge(t2.plain.githubRepoId, LOGINS.signer1)).body).toBe(unsigned);
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer2)).body).toBe(unsigned);
});

test("the opt-in of one tenant opens none of the other's repositories: the project badge of the repository that did not is the 404", async () => {
  const world = await publicWorld();
  const { t1, t2, db } = world;
  await db
    .updateTable('repositories')
    .set({ public_verification: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect((await world.projectBadge(t1.plain.githubRepoId)).statusCode).toBe(404);
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(404);
  expect((await world.projectBadge(t2.plain.githubRepoId)).body).toBe(badgeSvg('required'));
});

test('a suspended installation turns a badge that said "signed" into 404 not_found, the answer for an unknown repository, and lifting it turns it back', async () => {
  const world = await publicWorld();
  const { t1, t2, db } = world;
  const unknown = await world.signerBadge(987_654, LOGINS.signer1);
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe(badgeSvg('signed'));
  expect((await world.projectBadge(t1.plain.githubRepoId)).body).toBe(badgeSvg('required'));
  await db
    .updateTable('installations')
    .set({ suspended_at: world.clock.now() })
    .where('id', '=', t1.installationId)
    .execute();
  const suspended = await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1);
  expect(suspended.statusCode).toBe(404);
  expect(withoutRequestId(suspended)).toBe(withoutRequestId(unknown));
  expect((await world.projectBadge(t1.plain.githubRepoId)).statusCode).toBe(404);
  expect((await world.signerBadge(t2.plain.githubRepoId, LOGINS.signer2)).body).toBe(badgeSvg('signed'));
  await db.updateTable('installations').set({ suspended_at: null }).where('id', '=', t1.installationId).execute();
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe(badgeSvg('signed'));
});

test('a removed installation or a removed repository has no badge, and a restored one has it back', async () => {
  const world = await publicWorld();
  const { t1, db } = world;
  await db
    .updateTable('repositories')
    .set({ removed_at: world.clock.now() })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect((await world.projectBadge(t1.plain.githubRepoId)).statusCode).toBe(404);
  await db.updateTable('repositories').set({ removed_at: null }).where('id', '=', t1.plain.repositoryId).execute();
  expect((await world.projectBadge(t1.plain.githubRepoId)).statusCode).toBe(200);
  await db
    .updateTable('installations')
    .set({ deleted_at: world.clock.now() })
    .where('id', '=', t1.installationId)
    .execute();
  expect((await world.projectBadge(t1.plain.githubRepoId)).statusCode).toBe(404);
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(404);
});

test('the memory of the logins is one for the three routes: a login the JSON call looked up is not looked up again for the badge', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await world.verify(repository, LOGINS.signer1);
  await world.signerBadge(repository, 'OctoCat');
  await world.signerBadge(repository, 'nobody-has-this');
  await world.verify(repository, 'NOBODY-HAS-THIS');
  expect(lookups(world)).toBe(2);
  world.clock.advance(601_000);
  await world.signerBadge(repository, LOGINS.signer1);
  expect(lookups(world)).toBe(3);
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

test('GitHub failing is 503 upstream_unavailable with Retry-After on the signer badge, a JSON error and no image, kept by no cache and never a guess', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (const [name, error, wait] of FAILURES) {
    world.fakeGitHub.failNext('getUserAccount', error);
    const response = await world.signerBadge(repository, 'flaky-login');
    expect(response.statusCode, name).toBe(503);
    expect(parsed(response, errorResponseSchema).error.code, name).toBe('upstream_unavailable');
    expect(response.headers['retry-after'], name).toBe(wait);
    expect(response.headers['cache-control'], name).toBe('no-store');
    expect(response.headers['content-type'], name).toBe('application/json; charset=utf-8');
    expect(response.headers['access-control-allow-origin'], name).toBe('*');
    expect(response.headers['set-cookie'], name).toBeUndefined();
    expect(response.body, name).not.toContain('<svg');
  }
});

test('a failure of the lookup is not remembered by the badge: the next call asks GitHub again and draws the image', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  world.fakeGitHub.failNext('getUserAccount', new GitHubUnavailableError('GitHub answered 500 to zzzz-leak'));
  const failed = await world.signerBadge(repository, LOGINS.signer1);
  expect(failed.statusCode).toBe(503);
  expect(failed.body).not.toContain('zzzz');
  expect((await world.signerBadge(repository, LOGINS.signer1)).body).toBe(badgeSvg('signed'));
  expect(lookups(world)).toBe(2);
});

test('the project badge needs no GitHub: it is drawn while GitHub is down, and the repository is checked before GitHub is asked for the signer badge', async () => {
  const world = await publicWorld();
  world.fakeGitHub.failNext(
    'getUserAccount',
    new GitHubUnavailableError('GitHub answered 500 to GET /users/{username}'),
  );
  expect((await world.projectBadge(world.t1.plain.githubRepoId)).body).toBe(badgeSvg('required'));
  expect((await world.signerBadge(987_654, LOGINS.signer1)).statusCode).toBe(404);
  expect(lookups(world)).toBe(0);
});

test('the access log records the route templates of the badges and never the login, for an image, a refusal, a limit and an outage', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await world.signerBadge(repository, MARKER_LOGIN);
  await world.signerBadge(987_654, MARKER_LOGIN);
  await world.signerBadge(repository, `-${MARKER_LOGIN}`);
  await world.projectBadge(repository);
  await world.projectBadge(987_654);
  world.fakeGitHub.failNext('getUserAccount', new GitHubUnavailableError(`GitHub answered 500 to ${MARKER_LOGIN}`));
  await world.signerBadge(repository, 'zzzz-outage-login');
  for (let n = 0; n < 30; n++) {
    await world.signerBadge(repository, MARKER_LOGIN, { remoteAddress: '192.0.2.77' });
  }
  expect((await world.signerBadge(repository, MARKER_LOGIN, { remoteAddress: '192.0.2.77' })).statusCode).toBe(429);
  const text = world.logs.text();
  expect(text).not.toContain('zzzz');
  expect(text).not.toContain(MARKER_LOGIN);
  const requests = world.logs
    .lines()
    .flatMap((line) => (typeof line['req'] === 'object' && line['req'] !== null ? [line['req']] : []));
  expect(requests.length).toBeGreaterThan(30);
  expect(new Set(requests.map((request) => JSON.stringify(request)))).toEqual(
    new Set([
      '{"method":"GET","url":"/api/public/repos/:githubRepoId/signers/:login/badge.svg"}',
      '{"method":"GET","url":"/api/public/repos/:githubRepoId/badge.svg"}',
    ]),
  );
});

test('a badge path that matched no route is logged as the public prefix and nothing of what was asked', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await world.get(`/api/public/repos/${repository}/signers/${MARKER_LOGIN}%zz/badge.svg`);
  await world.get(`/api/public/repos/${repository}/signers/${MARKER_LOGIN}/badge.svg/extra`);
  await world.get(`/api/public/repos/${repository}/signers/${MARKER_LOGIN.repeat(10)}/badge.svg`);
  const text = world.logs.text();
  expect(text).not.toContain('zzzz');
  const urls = world.logs
    .lines()
    .flatMap((line) =>
      typeof line['req'] === 'object' && line['req'] !== null && 'url' in line['req'] ? [line['req'].url] : [],
    );
  expect(urls).toEqual(['/api/public/*', '/api/public/*', '/api/public/*']);
});
