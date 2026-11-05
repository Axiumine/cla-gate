// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { PUBLIC_LOOKUPS_PER_MINUTE } from '../../services/public-lookup-budget.ts';
import { parsed } from './document-fixture/test-support.ts';
import { LOGINS, lookups, type PublicWorld, publicWorld } from './public-verification-fixture/test-support.ts';

// The budget of an installation for uncached lookups in GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): the lookups of
// a login run on the installation token and its rate-limit lane, which the evaluation jobs share, so anonymous callers may spend only a
// small share of it, however many addresses they come from. A login the memory knows costs nothing; one it does not is a request to
// GitHub, and past the budget the answer is `503 upstream_unavailable` with `Retry-After`, with no request to GitHub.

const BUDGET = PUBLIC_LOOKUPS_PER_MINUTE;
const MINUTE_MS = 60_000;

/** The address `n` of the documentation range 198.51.100.0/24: `n` from 1 to 254. */
const addressOf = (n: number): string => `198.51.100.${n}`;

/** Asks for `count` logins nobody has asked about, `count` addresses taking turns so no client budget is spent, on `repository`. */
async function distinctLogins(world: PublicWorld, repository: number, count: number, tag: string) {
  const statuses: number[] = [];
  for (let n = 0; n < count; n++) {
    const response = await world.verify(repository, `${tag}-${n}`, { remoteAddress: addressOf((n % 200) + 1) });
    statuses.push(response.statusCode);
  }
  return statuses;
}

test('many addresses asking about many logins reach GitHub only as often as the budget of the installation allows', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  const statuses = await distinctLogins(world, repository, 90, 'probe');
  expect(lookups(world)).toBe(BUDGET);
  expect(statuses.slice(0, BUDGET).every((status) => status === 200)).toBe(true);
  expect(statuses.slice(BUDGET).every((status) => status === 503)).toBe(true);
});

test('a call past the budget is 503 upstream_unavailable with Retry-After to the end of the minute, uncached and readable by any site', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await distinctLogins(world, repository, BUDGET, 'probe');
  world.clock.advance(15_000);
  const refused = await world.verify(repository, 'probe-extra');
  expect(refused.statusCode).toBe(503);
  expect(parsed(refused, errorResponseSchema).error.code).toBe('upstream_unavailable');
  expect(refused.headers['retry-after']).toBe('45');
  expect(refused.headers['cache-control']).toBe('no-store');
  expect(refused.headers['access-control-allow-origin']).toBe('*');
  expect(refused.headers['set-cookie']).toBeUndefined();
  expect(refused.body).not.toContain('probe-extra');
  expect(lookups(world)).toBe(BUDGET);
});

test('a login the memory knows costs nothing: it is answered while the budget is spent, and the budget is the same for the badge', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  expect((await world.verify(repository, LOGINS.signer1)).statusCode).toBe(200);
  await distinctLogins(world, repository, BUDGET, 'probe');
  expect((await world.verify(repository, LOGINS.signer1)).statusCode).toBe(200);
  expect((await world.signerBadge(repository, 'probe-0')).statusCode).toBe(200);
  expect((await world.signerBadge(repository, 'probe-new')).statusCode).toBe(503);
  expect((await world.verify(repository, 'probe-new')).statusCode).toBe(503);
  expect(lookups(world)).toBe(BUDGET);
});

test('the budget starts afresh with the next minute', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  await distinctLogins(world, repository, BUDGET, 'probe');
  expect((await world.verify(repository, 'probe-late')).statusCode).toBe(503);
  world.clock.advance(MINUTE_MS);
  expect((await world.verify(repository, 'probe-late')).statusCode).toBe(200);
  expect(lookups(world)).toBe(BUDGET + 1);
});

test("the budget is the installation's, not the repository's or the address's, and another installation keeps its own", async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  await distinctLogins(world, t1.plain.githubRepoId, BUDGET, 'probe');
  expect((await world.verify(t1.plain.githubRepoId, 'probe-over')).statusCode).toBe(503);
  expect((await world.verify(t2.plain.githubRepoId, 'probe-over')).statusCode).toBe(200);
  expect(
    world.fakeGitHub.calls.filter(
      (call) => call.method === 'getUserAccount' && call.installationId === t2.githubInstallationId,
    ),
  ).toHaveLength(1);
});

test('a repository that may not be asked about spends none of the budget: it is answered before any lookup', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (let n = 0; n < BUDGET; n++) {
    expect((await world.verify(987_654, `probe-${n}`)).statusCode).toBe(404);
  }
  expect(lookups(world)).toBe(0);
  expect(await distinctLogins(world, repository, BUDGET, 'later')).toEqual(Array.from({ length: BUDGET }, () => 200));
});
