// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { badgeSvg } from '../../domain/badge-svg.ts';
import { parsed, withoutRequestId } from './document-fixture/test-support.ts';
import {
  BAD_LOGINS,
  BAD_REPOSITORY_IDS,
  badgePath,
  LOGINS,
  lookups,
  type PublicWorld,
  publicWorld,
  signerBadgePath,
} from './public-verification-fixture/test-support.ts';

// The input of the two badges (E22-S03): the same path parameters as GET /api/public/repos/:githubRepoId/signers/:login, checked before anything
// is read, so an input that is not a repository id or a GitHub login is `400 invalid_input` (a JSON error, not an image), with GitHub never
// asked and no request value in any image. The corpora are those of public-verification-routes-input.test.ts.

/** The one answer of a badge to input that cannot be: `400 invalid_input`, a JSON body, readable by any site, kept by no cache. */
function expectInvalid(response: Awaited<ReturnType<PublicWorld['get']>>, label: string) {
  expect(response.statusCode, label).toBe(400);
  expect(parsed(response, errorResponseSchema).error, label).toMatchObject({
    code: 'invalid_input',
    message: 'Bad Request',
  });
  expect(response.headers['content-type'], label).toBe('application/json; charset=utf-8');
  expect(response.headers['access-control-allow-origin'], label).toBe('*');
  expect(response.headers['cache-control'], label).toBe('no-store');
  expect(response.headers['set-cookie'], label).toBeUndefined();
  expect(response.body, label).not.toContain('<svg');
}

test('a repository id that is not a positive safe integer in plain digits is 400 invalid_input on both badges, and GitHub is not asked', async () => {
  const world = await publicWorld();
  for (const [name, id] of BAD_REPOSITORY_IDS) {
    expectInvalid(await world.get(badgePath(id)), `the project badge for a repository id with ${name}`);
    expectInvalid(
      await world.get(signerBadgePath(id, LOGINS.signer1)),
      `the signer badge for a repository id with ${name}`,
    );
  }
  expect(lookups(world)).toBe(0);
});

test('a login that GitHub cannot have is 400 invalid_input on the signer badge, and GitHub is not asked', async () => {
  const world = await publicWorld();
  for (const [name, login] of BAD_LOGINS) {
    expectInvalid(
      await world.get(signerBadgePath(world.t1.plain.githubRepoId, login)),
      `the signer badge for a login with ${name}`,
    );
  }
  expect(lookups(world)).toBe(0);
});

test('every wrong input of either parameter, on either badge and on the JSON call, has one answer: the same body but for the request id', async () => {
  const world = await publicWorld();
  const repository = String(world.t1.plain.githubRepoId);
  const answers = [
    await world.get(badgePath('abc')),
    await world.get(badgePath('0')),
    await world.get(signerBadgePath('abc', LOGINS.signer1)),
    await world.get(signerBadgePath(repository, '-octocat')),
    await world.get(signerBadgePath(repository, 'a'.repeat(40))),
    await world.verify('abc', '-octocat'),
  ];
  expect(new Set(answers.map(withoutRequestId)).size).toBe(1);
});

test('a path that never reaches the route is invalid input too, from the same answer: a bad percent-escape and a parameter longer than the router reads', async () => {
  const world = await publicWorld();
  const repository = String(world.t1.plain.githubRepoId);
  expectInvalid(await world.get(signerBadgePath(repository, 'octo%zzcat')), 'a bad escape in the login');
  expectInvalid(await world.get(badgePath('%zz')), 'a bad escape in the repository id');
  expectInvalid(await world.get(signerBadgePath(repository, 'a'.repeat(5000))), 'a login of 5000 characters');
  expectInvalid(await world.get(badgePath('9'.repeat(101))), 'a repository id of 101 digits');
  expect(lookups(world)).toBe(0);
});

test('the longest login there is, 39 characters, and the shortest, one, get the "not signed" image; so do digits-only and hyphenated logins', async () => {
  const world = await publicWorld();
  const logins = ['a'.repeat(39), 'a', 'Z', '1', '123456', 'a-b', `${'a-'.repeat(19)}a`, 'A1-b2'];
  for (const login of logins) {
    const response = await world.signerBadge(world.t1.plain.githubRepoId, login);
    expect([response.statusCode, response.body], login).toEqual([200, badgeSvg('not_signed')]);
  }
  expect(lookups(world)).toBe(logins.length);
});

test('the largest safe integer is a repository id on both badges, and an unknown one: 404, not an invalid input', async () => {
  const world = await publicWorld();
  const id = String(Number.MAX_SAFE_INTEGER);
  expect((await world.projectBadge(id)).statusCode).toBe(404);
  expect((await world.signerBadge(id, LOGINS.signer1)).statusCode).toBe(404);
});

test('a query string is not part of the question: it changes no image, and nothing of it is in the bytes', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  const queries = [
    '',
    '?label=zzzz',
    '?login=stranger&signed=false',
    '?style=for-the-badge&color=red',
    '?<script>zzzz</script>',
  ];
  const projects = await Promise.all(queries.map((query) => world.get(`${badgePath(repository)}${query}`)));
  const signers = await Promise.all(
    queries.map((query) => world.get(`${signerBadgePath(repository, LOGINS.signer1)}${query}`)),
  );
  expect(new Set(projects.map((response) => response.body))).toEqual(new Set([badgeSvg('required')]));
  expect(new Set(signers.map((response) => response.body))).toEqual(new Set([badgeSvg('signed')]));
});

test.each([
  ['an extension of another type', (id: number) => `/api/public/repos/${id}/badge.png`],
  ['the name in capitals', (id: number) => `/api/public/repos/${id}/BADGE.SVG`],
  ['a double extension', (id: number) => `/api/public/repos/${id}/badge.svg.png`],
  ['a trailing slash', (id: number) => `/api/public/repos/${id}/badge.svg/`],
  ['an extra segment', (id: number) => `/api/public/repos/${id}/badge.svg/extra`],
  ['no extension', (id: number) => `/api/public/repos/${id}/badge`],
  ['the signer badge without an extension', (id: number) => `/api/public/repos/${id}/signers/octocat/badge`],
  ['the signer badge in capitals', (id: number) => `/api/public/repos/${id}/signers/octocat/BADGE.SVG`],
  ['the signer badge with an extra segment', (id: number) => `/api/public/repos/${id}/signers/octocat/badge.svg/extra`],
  ['a repository name in place of the id', () => '/api/public/repos/org-1/repo/badge.svg'],
])(
  'a path with another shape is the 404 of any unknown path, with no CORS header and no image: %s',
  async (_name, pathOf) => {
    const world = await publicWorld();
    const response = await world.get(pathOf(world.t1.plain.githubRepoId));
    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['content-type']).not.toContain('svg');
    expect(response.body).not.toContain('<svg');
    expect(lookups(world)).toBe(0);
  },
);

test('a file name in the place of the login is no badge: it is read as a login, and it is not one', async () => {
  const world = await publicWorld();
  const base = `/api/public/repos/${world.t1.plain.githubRepoId}/signers`;
  expectInvalid(await world.get(`${base}/badge.svg`), 'badge.svg as the login');
  expectInvalid(await world.get(`${base}/octocat.svg`), 'a login with the extension');
  expect(lookups(world)).toBe(0);
});

test('the shared hostile corpus, as a login, is refused, or an unknown login when it is a login after all: never an error, never in the image', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  let asked = 0;
  for (const name of HOSTILE_NAMES) {
    const response = await world.signerBadge(repository, encodeURIComponent(name));
    expect([200, 400], name).toContain(response.statusCode);
    if (response.statusCode === 200) {
      asked += 1;
      expect(response.body, name).toBe(badgeSvg('not_signed'));
    } else {
      expect(response.body, name).not.toContain('<svg');
    }
  }
  expect(asked).toBeGreaterThan(0);
  expect(lookups(world)).toBe(asked);
});

test('headers a client sends are not read into the answer: Accept, Origin, Referer and Host change neither the bytes nor the headers', async () => {
  const world = await publicWorld();
  const url = signerBadgePath(world.t1.plain.githubRepoId, LOGINS.signer1);
  const plain = await world.get(url);
  const hostile = await world.get(url, {
    headers: {
      accept: 'text/html,application/json',
      origin: 'https://zzzz.example',
      referer: 'https://zzzz.example/<script>',
      'x-forwarded-host': 'zzzz.example',
      'accept-language': 'zz',
    },
  });
  expect(hostile.body).toBe(plain.body);
  expect(hostile.headers['access-control-allow-origin']).toBe('*');
  expect(hostile.headers['content-type']).toBe(plain.headers['content-type']);
  expect(hostile.headers['content-security-policy']).toBe(plain.headers['content-security-policy']);
  expect(JSON.stringify(hostile.headers)).not.toContain('zzzz');
});
