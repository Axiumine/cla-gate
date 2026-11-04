// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersion } from '../db/test-support.ts';
import { errorCodeOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  LOGINS,
  lookups,
  type PublicWorld,
  publicWorld,
  revokeSignature,
  signedOf,
} from './public-verification-fixture/test-support.ts';

// GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): what a good call answers and with which headers, the four answers that are
// one, the refusals that are one, and the verbs it does not answer. The hostile inputs are in public-verification-routes-input.test.ts,
// the budgets in public-verification-routes-limits.test.ts, GitHub and the cache in public-verification-routes-upstream.test.ts,
// the other tenant, the suspended one and the log in public-verification-routes-tenants.test.ts.

/** The headers a client sees that do not change from one call to the next: the others are the request id, the date and the budget left. */
const stable = (response: { headers: Record<string, unknown> }) => ({
  cacheControl: response.headers['cache-control'],
  origin: response.headers['access-control-allow-origin'],
  type: response.headers['content-type'],
  length: response.headers['content-length'],
  cookie: response.headers['set-cookie'],
});

test('the signer of the repository is signed: 200 {"signed":true} for anyone, with no session and no cookie', async () => {
  const world = await publicWorld();
  const response = await world.verify(world.t1.plain.githubRepoId, LOGINS.signer1);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('{"signed":true}');
  expect(signedOf(response)).toBe(true);
});

test('a good call is cacheable for five minutes by anyone, readable by any site, and sets no cookie, whatever cookie it was sent', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const bare = await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
  const withCookie = await world.verify(t1.plain.githubRepoId, LOGINS.signer1, {
    headers: { cookie: 'cla_session=made-up-session-zzzz; other=1' },
  });
  for (const response of [bare, withCookie]) {
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.cookies).toEqual([]);
  }
  expect(withCookie.body).toBe(bare.body);
});

test('OctoCat is octocat: the case of the login changes nothing, and GitHub is asked once for the two', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const answers: string[] = [];
  for (const login of ['octocat', 'OctoCat', 'OCTOCAT']) {
    answers.push((await world.verify(t1.plain.githubRepoId, login)).body);
  }
  expect(answers).toEqual(['{"signed":true}', '{"signed":true}', '{"signed":true}']);
  expect(lookups(world)).toBe(1);
});

test('the four false cases answer the same bytes with the same headers: never signed, revoked, an outdated major, a login nobody has', async () => {
  const world = await publicWorld();
  const { db, t1, t2 } = world;
  const never = await world.verify(t1.plain.githubRepoId, LOGINS.stranger);
  const unknown = await world.verify(t1.plain.githubRepoId, 'nobody-has-this-login');
  await revokeSignature(world);
  const revoked = await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
  const second = await publishVersion(db, t2.documentId, t2.publisherId, { major: 2, minor: 0, text: 'Second terms' });
  await db.updateTable('cla_documents').set({ active_version_id: second.id }).where('id', '=', t2.documentId).execute();
  const outdated = await world.verify(t2.plain.githubRepoId, LOGINS.signer2);
  const answers = [never, revoked, outdated, unknown];
  expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200]);
  expect(answers.map((answer) => answer.body)).toEqual(Array.from({ length: 4 }, () => '{"signed":false}'));
  expect(answers.map(stable)).toEqual(Array.from({ length: 4 }, () => stable(never)));
  expect(stable(never).cacheControl).toBe('public, max-age=300');
});

test('a repository with no document to enforce answers signed false and never asks GitHub who the login is', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: null })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const response = await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
  expect([response.statusCode, response.body]).toEqual([200, '{"signed":false}']);
  expect(lookups(world)).toBe(0);
});

test('the answer follows the signatures at once: a revocation turns a cached login false, because the signature is read on every call', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  expect(signedOf(await world.verify(t1.plain.githubRepoId, LOGINS.signer1))).toBe(true);
  await revokeSignature(world);
  expect(signedOf(await world.verify(t1.plain.githubRepoId, LOGINS.signer1))).toBe(false);
  expect(lookups(world)).toBe(1);
});

/** The states in which a repository may not be asked about, each as a change to the world. */
const NOT_ASKABLE: readonly (readonly [string, (world: PublicWorld) => Promise<unknown>])[] = [
  [
    'enforcement is off',
    (w) => w.db.updateTable('repositories').set({ enabled: false }).where('id', '=', w.t1.plain.repositoryId).execute(),
  ],
  [
    'the maintainers did not opt in',
    (w) =>
      w.db
        .updateTable('repositories')
        .set({ public_verification: false })
        .where('id', '=', w.t1.plain.repositoryId)
        .execute(),
  ],
  [
    'the repository was removed',
    (w) =>
      w.db
        .updateTable('repositories')
        .set({ removed_at: w.clock.now() })
        .where('id', '=', w.t1.plain.repositoryId)
        .execute(),
  ],
  [
    'the installation is suspended',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ suspended_at: w.clock.now() })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
  [
    'the installation was uninstalled',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ deleted_at: w.clock.now() })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
  [
    'the installation is rejected',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ admission_status: 'rejected', admission_reason: 'policy_changed' })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
];

test.each(NOT_ASKABLE)(
  'a repository for which %s is 404 not_found, byte for byte the answer for a repository that does not exist',
  async (_name, change) => {
    const world = await publicWorld();
    const { t1 } = world;
    const unknown = await world.verify(987_654, LOGINS.signer1);
    await change(world);
    const response = await world.verify(t1.plain.githubRepoId, LOGINS.signer1);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
    expect(withoutRequestId(response)).toBe(withoutRequestId(unknown));
    expect(stable(response)).toEqual(stable(unknown));
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(lookups(world)).toBe(0);
  },
);

test('an unknown login on a repository that may not be asked about is the 404, never the false: the refusal does not depend on the login', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ public_verification: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const bodies: string[] = [];
  for (const login of [LOGINS.signer1, LOGINS.stranger, 'nobody-has-this-login']) {
    bodies.push(withoutRequestId(await world.verify(t1.plain.githubRepoId, login)));
  }
  expect(new Set(bodies).size).toBe(1);
  expect(bodies[0]).toContain('"not_found"');
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
  '%s on the call is a 404 with no CORS header and no cache header: the call is GET only',
  async (method) => {
    const world = await publicWorld();
    const response = await world.app.inject({
      method,
      url: `/api/public/repos/${world.t1.plain.githubRepoId}/signers/octocat`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['cache-control']).toBeUndefined();
    expect(lookups(world)).toBe(0);
  },
);
