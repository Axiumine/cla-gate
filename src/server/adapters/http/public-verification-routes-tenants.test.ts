// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { withoutRequestId } from './document-fixture/test-support.ts';
import { LOGINS, lookups, publicWorld, signedOf } from './public-verification-fixture/test-support.ts';

// The tenants and the log of GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): a signature of one tenant counts for that
// tenant's repositories only, a suspended or removed installation turns a true answer into the 404 of an unknown repository, and the
// access log writes the route template and never the login that was asked about.

/** A login that no other test uses and that no answer or log may carry: the marker is not a digit run or a repeated letter. */
const MARKER_LOGIN = 'zzzz-marker-login';

test("a signature of one tenant does not count in the other: each signer is signed for their own tenant's repository only", async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  expect(signedOf(await world.verify(t1.plain.githubRepoId, LOGINS.signer1))).toBe(true);
  expect(signedOf(await world.verify(t2.plain.githubRepoId, LOGINS.signer2))).toBe(true);
  expect(signedOf(await world.verify(t2.plain.githubRepoId, LOGINS.signer1))).toBe(false);
  expect(signedOf(await world.verify(t1.plain.githubRepoId, LOGINS.signer2))).toBe(false);
});

test("the opt-in of one tenant opens none of the other's repositories", async () => {
  const world = await publicWorld();
  const { t1, t2, db } = world;
  await db
    .updateTable('repositories')
    .set({ public_verification: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(404);
  expect((await world.verify(t2.plain.githubRepoId, LOGINS.signer2)).statusCode).toBe(200);
});

test('a suspended installation turns a true answer into 404 not_found, the answer for an unknown repository, and lifting the suspension turns it back', async () => {
  const world = await publicWorld();
  const { t1, t2, db } = world;
  const unknown = await world.verify(987_654, LOGINS.signer1);
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe('{"signed":true}');
  await db
    .updateTable('installations')
    .set({ suspended_at: world.clock.now() })
    .where('id', '=', t1.installationId)
    .execute();
  const suspended = await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
  expect(suspended.statusCode).toBe(404);
  expect(withoutRequestId(suspended)).toBe(withoutRequestId(unknown));
  expect(signedOf(await world.verify(t2.plain.githubRepoId, LOGINS.signer2))).toBe(true);
  await db.updateTable('installations').set({ suspended_at: null }).where('id', '=', t1.installationId).execute();
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe('{"signed":true}');
});

test('a removed installation turns a true answer into 404 not_found, and so does a repository removed from it', async () => {
  const world = await publicWorld();
  const { t1, db } = world;
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(200);
  await db
    .updateTable('repositories')
    .set({ removed_at: world.clock.now() })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(404);
  await db.updateTable('repositories').set({ removed_at: null }).where('id', '=', t1.plain.repositoryId).execute();
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(200);
  await db
    .updateTable('installations')
    .set({ deleted_at: world.clock.now() })
    .where('id', '=', t1.installationId)
    .execute();
  expect((await world.verify(t1.plain.githubRepoId, LOGINS.signer1)).statusCode).toBe(404);
});

test('the access log records the route template and never the login, for an answer, a refusal, a limit and an outage', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await world.verify(repository, MARKER_LOGIN);
  await world.verify(987_654, MARKER_LOGIN);
  await world.verify(repository, `-${MARKER_LOGIN}`);
  world.fakeGitHub.failNext('getUserAccount', new GitHubUnavailableError(`GitHub answered 500 to ${MARKER_LOGIN}`));
  await world.verify(repository, 'zzzz-outage-login');
  for (let n = 0; n < 30; n++) {
    await world.verify(repository, MARKER_LOGIN, { remoteAddress: '192.0.2.77' });
  }
  const limited = await world.verify(repository, MARKER_LOGIN, { remoteAddress: '192.0.2.77' });
  expect(limited.statusCode).toBe(429);
  const text = world.logs.text();
  expect(text).not.toContain('zzzz');
  expect(text).not.toContain(MARKER_LOGIN);
  const requests = world.logs
    .lines()
    .flatMap((line) => (typeof line['req'] === 'object' && line['req'] !== null ? [line['req']] : []));
  expect(requests.length).toBeGreaterThan(30);
  expect(new Set(requests.map((request) => JSON.stringify(request)))).toEqual(
    new Set(['{"method":"GET","url":"/api/public/repos/:githubRepoId/signers/:login"}']),
  );
});

test('a path that matched no route is logged as the public prefix and nothing of what was asked: a bad escape, a long login, extra segments', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await world.verify(repository, `${MARKER_LOGIN}%zz`);
  await world.verify(repository, MARKER_LOGIN.repeat(10));
  await world.app.inject({ url: `/api/public/repos/${repository}/signers/${MARKER_LOGIN}/extra` });
  await world.app.inject({ method: 'POST', url: `/api/public/repos/${repository}/signers/${MARKER_LOGIN}` });
  const text = world.logs.text();
  expect(text).not.toContain('zzzz');
  const urls = world.logs
    .lines()
    .flatMap((line) =>
      typeof line['req'] === 'object' && line['req'] !== null && 'url' in line['req'] ? [line['req'].url] : [],
    );
  expect(urls).toEqual(['/api/public/*', '/api/public/*', '/api/public/*', '/api/public/*']);
  expect(lookups(world)).toBe(0);
});
