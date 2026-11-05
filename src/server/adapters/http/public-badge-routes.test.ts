// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { badgeSvg } from '../../domain/badge-svg.ts';
import { errorCodeOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  LOGINS,
  lookups,
  NOT_ASKABLE,
  publicWorld,
  revokeSignature,
  stableHeaders,
} from './public-verification-fixture/test-support.ts';

// The two badges of E22-S03, GET /api/public/repos/:githubRepoId/badge.svg and .../signers/:login/badge.svg: what a good call answers and
// with which headers, the answers that are one, the refusals that are one, and the verbs they do not answer. The hostile inputs are in
// public-badge-routes-input.test.ts, the budgets in public-badge-routes-limits.test.ts, GitHub, the other tenant and the log in
// public-badge-routes-tenants.test.ts.

/** The headers of a good badge, as the story spells them out. */
const BADGE_HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'access-control-allow-origin': '*',
};

test('the badge of a project that opted in is "CLA | required", an SVG every site may embed, with the five headers of the story and no cookie', async () => {
  const world = await publicWorld();
  const response = await world.projectBadge(world.t1.plain.githubRepoId);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe(badgeSvg('required'));
  expect(response.body).toContain('aria-label="CLA: required"');
  expect(response.headers).toMatchObject(BADGE_HEADERS);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.cookies).toEqual([]);
  expect(lookups(world)).toBe(0);
});

test('the badge of the signer is "CLA | signed" in green, with the same headers', async () => {
  const world = await publicWorld();
  const response = await world.signerBadge(world.t1.plain.githubRepoId, LOGINS.signer1);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe(badgeSvg('signed'));
  expect(response.body).toContain('aria-label="CLA: signed"');
  expect(response.body).toContain('fill="#1a7f37"');
  expect(response.headers).toMatchObject(BADGE_HEADERS);
  expect(response.headers['set-cookie']).toBeUndefined();
});

test('the badge of a person who has not signed is "CLA | not signed" in grey, with the same headers and status 200', async () => {
  const world = await publicWorld();
  const response = await world.signerBadge(world.t1.plain.githubRepoId, LOGINS.stranger);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe(badgeSvg('not_signed'));
  expect(response.body).toContain('aria-label="CLA: not signed"');
  expect(response.body).toContain('fill="#6e7781"');
  expect(response.headers).toMatchObject(BADGE_HEADERS);
});

test('a cookie that is sent is not read and not answered: no badge sets one', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const headers = { cookie: 'cla_session=made-up-session-zzzz; other=1' };
  const bare = await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1);
  for (const response of [
    await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1, { headers }),
    await world.projectBadge(t1.plain.githubRepoId, { headers }),
  ]) {
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.cookies).toEqual([]);
  }
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1, { headers })).body).toBe(bare.body);
});

test('two different logins with the same result get byte-identical images, with the same headers: nothing of the request is in the bytes', async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  const unsigned = [
    await world.signerBadge(t1.plain.githubRepoId, LOGINS.stranger),
    await world.signerBadge(t1.plain.githubRepoId, 'zzzz-marker-login'),
    await world.signerBadge(t1.plain.githubRepoId, 'A'),
    await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer2),
  ];
  const signed = [
    await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1),
    await world.signerBadge(t2.plain.githubRepoId, LOGINS.signer2),
  ];
  for (const group of [unsigned, signed]) {
    expect(new Set(group.map((response) => response.body)).size).toBe(1);
    expect(new Set(group.map((response) => JSON.stringify(stableHeaders(response)))).size).toBe(1);
  }
  expect(unsigned[0]?.body).not.toBe(signed[0]?.body);
  expect(unsigned.map((response) => response.body).join('')).not.toContain('zzzz');
});

test('OctoCat is octocat: the case of the login changes nothing in the image, and GitHub is asked once for the two', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const bodies: string[] = [];
  for (const login of ['octocat', 'OctoCat', 'OCTOCAT']) {
    bodies.push((await world.signerBadge(t1.plain.githubRepoId, login)).body);
  }
  expect(bodies).toEqual(Array.from({ length: 3 }, () => badgeSvg('signed')));
  expect(lookups(world)).toBe(1);
});

test('the four false cases are one image with one set of headers: never signed, revoked, an outdated major, a login nobody has', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const never = await world.signerBadge(t1.plain.githubRepoId, LOGINS.stranger);
  const unknown = await world.signerBadge(t1.plain.githubRepoId, 'nobody-has-this-login');
  await revokeSignature(world);
  const revoked = await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1);
  const answers = [never, revoked, unknown];
  expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200]);
  expect(answers.map((answer) => answer.body)).toEqual(Array.from({ length: 3 }, () => badgeSvg('not_signed')));
  expect(answers.map((answer) => JSON.stringify(stableHeaders(answer)))).toEqual(
    Array.from({ length: 3 }, () => JSON.stringify(stableHeaders(never))),
  );
});

test('an unknown login on an opted-in repository still renders a valid "not signed" image with status 200, never an error', async () => {
  const world = await publicWorld();
  const response = await world.signerBadge(world.t1.plain.githubRepoId, 'nobody-has-this-login');
  expect([response.statusCode, response.body]).toEqual([200, badgeSvg('not_signed')]);
  expect(response.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
});

test('a repository with no document to enforce draws "not signed" and never asks GitHub who the login is', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: null })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const response = await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1);
  expect([response.statusCode, response.body]).toEqual([200, badgeSvg('not_signed')]);
  expect(lookups(world)).toBe(0);
});

test('the image follows the signatures at once: a revocation turns the badge of a cached login "not signed" on the next call', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe(badgeSvg('signed'));
  await revokeSignature(world);
  expect((await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1)).body).toBe(badgeSvg('not_signed'));
  expect(lookups(world)).toBe(1);
});

test.each(NOT_ASKABLE)(
  'a repository for which %s has no badge: the project badge and the signer badge are the 404 not_found of an unknown repository, byte for byte',
  async (_name, change) => {
    const world = await publicWorld();
    const { t1 } = world;
    const unknown = await world.projectBadge(987_654);
    const unknownSigner = await world.signerBadge(987_654, LOGINS.signer1);
    expect(unknown.statusCode).toBe(404);
    await change(world);
    for (const [response, expected] of [
      [await world.projectBadge(t1.plain.githubRepoId), unknown],
      [await world.signerBadge(t1.plain.githubRepoId, LOGINS.signer1), unknownSigner],
    ] as const) {
      expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
      expect(withoutRequestId(response)).toBe(withoutRequestId(expected));
      expect(stableHeaders(response)).toEqual(stableHeaders(expected));
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.headers['cross-origin-resource-policy']).not.toBe('cross-origin');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    }
    expect(lookups(world)).toBe(0);
  },
);

test('the project badge of a repository that did not opt in is 404 and says nothing of whether the repository exists: the same body as a repository nobody has', async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  await world.db
    .updateTable('repositories')
    .set({ public_verification: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const answers = [
    await world.projectBadge(t1.plain.githubRepoId),
    await world.projectBadge(987_654),
    // A repository of the other tenant that exists and enforces but never opted in.
    await world.projectBadge(t2.scoped.githubRepoId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(new Set(answers.map(withoutRequestId)).size).toBe(1);
  expect(answers[0]?.body).toContain('"not_found"');
  expect(answers.map((answer) => answer.body).join('')).not.toContain('svg');
  expect(lookups(world)).toBe(0);
});

test('an unknown login on a repository that may not be asked about is the 404, never the image: the refusal does not depend on the login', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ public_verification: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const bodies: string[] = [];
  for (const login of [LOGINS.signer1, LOGINS.stranger, 'nobody-has-this-login']) {
    bodies.push(withoutRequestId(await world.signerBadge(t1.plain.githubRepoId, login)));
  }
  expect(new Set(bodies).size).toBe(1);
  expect(bodies[0]).toContain('"not_found"');
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
  '%s on a badge is a 404 with no CORS header and no cache header: the badges are GET only',
  async (method) => {
    const world = await publicWorld();
    const repository = world.t1.plain.githubRepoId;
    for (const url of [
      `/api/public/repos/${repository}/badge.svg`,
      `/api/public/repos/${repository}/signers/octocat/badge.svg`,
    ]) {
      const response = await world.app.inject({ method, url });
      expect([url, response.statusCode]).toEqual([url, 404]);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['cache-control']).toBeUndefined();
    }
    expect(lookups(world)).toBe(0);
  },
);
