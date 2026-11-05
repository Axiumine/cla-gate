// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { parsed } from './document-fixture/test-support.ts';
import {
  BAD_LOGINS,
  BAD_REPOSITORY_IDS,
  LOGINS,
  lookups,
  publicWorld,
  signedOf,
} from './public-verification-fixture/test-support.ts';

// The input of GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): both path parameters are checked before anything is read, so
// an input that is not a repository id or a GitHub login is `400 invalid_input`, answered the same way for every kind of wrong, with
// GitHub never asked and nothing of the input in the log.

/** Asks and checks the answer is the one `400 invalid_input` of this route, readable by any site, kept by no cache; `label` names the case in a failure. */
async function expectInvalid(
  world: Awaited<ReturnType<typeof publicWorld>>,
  repository: string,
  login: string,
  label: string,
) {
  const response = await world.verify(repository, login);
  expect(response.statusCode, label).toBe(400);
  expect(parsed(response, errorResponseSchema).error, label).toMatchObject({
    code: 'invalid_input',
    message: 'Bad Request',
  });
  expect(response.headers['access-control-allow-origin'], label).toBe('*');
  expect(response.headers['cache-control'], label).toBe('no-store');
  expect(response.headers['set-cookie'], label).toBeUndefined();
}

test('a repository id that is not a positive safe integer in plain digits is 400 invalid_input, and GitHub is not asked', async () => {
  const world = await publicWorld();
  for (const [name, id] of BAD_REPOSITORY_IDS) {
    await expectInvalid(world, id, LOGINS.signer1, `a repository id with ${name}`);
  }
  expect(lookups(world)).toBe(0);
});

test('a login that GitHub cannot have is 400 invalid_input, and GitHub is not asked', async () => {
  const world = await publicWorld();
  for (const [name, login] of BAD_LOGINS) {
    await expectInvalid(world, String(world.t1.plain.githubRepoId), login, `a login with ${name}`);
  }
  expect(lookups(world)).toBe(0);
});

test('every wrong input of either parameter has one answer: the same body but for the request id, whatever was wrong', async () => {
  const world = await publicWorld();
  const repository = String(world.t1.plain.githubRepoId);
  const answers = [
    await world.verify('abc', LOGINS.signer1),
    await world.verify('0', LOGINS.signer1),
    await world.verify(repository, '-octocat'),
    await world.verify(repository, 'a'.repeat(40)),
    await world.verify('abc', '-octocat'),
  ];
  expect(new Set(answers.map((answer) => answer.body.replace(/"requestId":"[^"]*"/, ''))).size).toBe(1);
});

test('a path that never reaches the route is invalid input too, from the same answer: a bad percent-escape and a parameter longer than the router reads', async () => {
  const world = await publicWorld();
  const repository = String(world.t1.plain.githubRepoId);
  await expectInvalid(world, repository, 'octo%zzcat', 'a bad escape');
  await expectInvalid(world, repository, 'a'.repeat(101), 'a login of 101 characters');
  await expectInvalid(world, repository, 'a'.repeat(5000), 'a login of 5000 characters');
  await expectInvalid(world, '9'.repeat(101), LOGINS.signer1, 'a repository id of 101 digits');
  expect(lookups(world)).toBe(0);
});

test('the longest login there is, 39 characters, and the shortest, one, are asked about; digits-only and hyphenated logins as well', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  const logins = ['a'.repeat(39), 'a', 'Z', '1', '123456', 'a-b', 'a-b-c-d', `${'a-'.repeat(19)}a`, 'A1-b2'];
  for (const login of logins) {
    const response = await world.verify(repository, login);
    expect([response.statusCode, signedOf(response)], login).toEqual([200, false]);
  }
  expect(lookups(world)).toBe(logins.length);
});

test('the largest safe integer is a repository id, and an unknown one: 404, not an invalid input', async () => {
  const world = await publicWorld();
  const response = await world.verify(String(Number.MAX_SAFE_INTEGER), LOGINS.signer1);
  expect(response.statusCode).toBe(404);
});

test('a query string is not part of the question: it changes no answer and is not looked at', async () => {
  const world = await publicWorld();
  const url = `/api/public/repos/${world.t1.plain.githubRepoId}/signers/${LOGINS.signer1}?login=${LOGINS.stranger}&signed=false`;
  const response = await world.app.inject({ method: 'GET', url });
  expect([response.statusCode, response.body]).toEqual([200, '{"signed":true}']);
});

test('a path with another shape is the 404 of any unknown path, with no CORS header: extra segments, an empty login, a trailing slash, a repository name', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (const path of [
    `/api/public/repos/${repository}/signers/octocat/extra`,
    `/api/public/repos/${repository}/signers/..`,
    `/api/public/repos/${repository}/signers`,
    `/api/public/repos/${repository}`,
    `/api/public/repos/org-1/repo/signers/octocat`,
    `/api/public/repos/${repository}/signers/octo/cat`,
    `/api/public/${repository}/signers/octocat`,
  ]) {
    const response = await world.app.inject({ method: 'GET', url: path });
    expect([path, response.statusCode]).toEqual([path, 404]);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  }
  expect(lookups(world)).toBe(0);
});

test('the shared hostile corpus, as a login, is refused, or unknown when it is a login after all: never an error, and GitHub is asked only for the logins', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  let asked = 0;
  for (const name of HOSTILE_NAMES) {
    const response = await world.verify(repository, encodeURIComponent(name));
    expect([200, 400], name).toContain(response.statusCode);
    if (response.statusCode === 200) {
      asked += 1;
      expect(response.body, name).toBe('{"signed":false}');
    }
  }
  expect(asked).toBeGreaterThan(0);
  expect(lookups(world)).toBe(asked);
});
