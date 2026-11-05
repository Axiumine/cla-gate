// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parsed } from './document-fixture/test-support.ts';
import { PUBLIC_RATE_LIMITS } from './public-rate-limit.ts';
import { LOGINS, lookups, type PublicWorld, publicWorld } from './public-verification-fixture/test-support.ts';

// The budgets of GET /api/public/repos/:githubRepoId/signers/:login (E22-S02): 30 a minute for each client address and 600 a minute for
// each repository, then `429 rate_limited` with `Retry-After`. The address is the one Fastify derives from TRUST_PROXY (E04-S03). The
// stores are in memory, which is right for the one process the instance runs as (docs/security.md). Every client below has an address
// of its own in 192.0.2.0/24 or 198.51.100.0/24, which are documentation ranges.

/** The statuses of `count` calls from `address` for `login` on `repository`. */
async function callsFrom(
  world: PublicWorld,
  address: string,
  count: number,
  target: { readonly repository?: number | string; readonly login?: string } = {},
): Promise<number[]> {
  const statuses: number[] = [];
  for (let n = 0; n < count; n++) {
    const response = await world.verify(
      target.repository ?? world.t1.plain.githubRepoId,
      target.login ?? LOGINS.signer1,
      {
        remoteAddress: address,
      },
    );
    statuses.push(response.statusCode);
  }
  return statuses;
}

/** `count` copies of `status`. */
const times = (count: number, status: number): number[] => Array.from({ length: count }, () => status);

/** The address `n` of the documentation range 198.51.100.0/24: `n` from 1 to 254. */
const addressOf = (n: number): string => `198.51.100.${n}`;

test('the budgets are 30 a minute for each client and 600 for each repository', () => {
  expect(PUBLIC_RATE_LIMITS).toEqual({ perClient: 30, perRepository: 600 });
});

test('the 31st request in a minute from one address is 429 rate_limited with Retry-After, and the 30 before it are answered', async () => {
  const world = await publicWorld();
  expect(new Set(await callsFrom(world, '192.0.2.1', 30))).toEqual(new Set([200]));
  const limited = await world.verify(world.t1.plain.githubRepoId, LOGINS.signer1, { remoteAddress: '192.0.2.1' });
  expect(limited.statusCode).toBe(429);
  expect(parsed(limited, errorResponseSchema).error.code).toBe('rate_limited');
  expect(limited.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  expect(limited.headers['access-control-allow-origin']).toBe('*');
  expect(limited.headers['cache-control']).toBe('no-store');
  expect(limited.headers['set-cookie']).toBeUndefined();
  expect(lookups(world)).toBe(1);
});

test('a client that is over its budget stays over it, and another address is not touched', async () => {
  const world = await publicWorld();
  await callsFrom(world, '192.0.2.1', 30);
  expect(await callsFrom(world, '192.0.2.1', 3)).toEqual([429, 429, 429]);
  expect(await callsFrom(world, '192.0.2.2', 1)).toEqual([200]);
});

test('the budget counts every request of the client, whatever the answer: the refusals and the unknown repositories spend it too', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  const mixed = [
    ...(await callsFrom(world, '192.0.2.3', 10, { repository: 987_654 })),
    ...(await callsFrom(world, '192.0.2.3', 10, { repository: 'abc' })),
    ...(await callsFrom(world, '192.0.2.3', 10, { repository })),
  ];
  expect(mixed).toEqual([...times(10, 404), ...times(10, 400), ...times(10, 200)]);
  expect(await callsFrom(world, '192.0.2.3', 1)).toEqual([429]);
});

test('the budget of a client is for all the repositories it asks about, not for each', async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  await callsFrom(world, '192.0.2.4', 15, { repository: t1.plain.githubRepoId });
  await callsFrom(world, '192.0.2.4', 15, { repository: t2.plain.githubRepoId, login: LOGINS.signer2 });
  expect(await callsFrom(world, '192.0.2.4', 1, { repository: t2.plain.githubRepoId, login: LOGINS.signer2 })).toEqual([
    429,
  ]);
});

test('with TRUST_PROXY=false a spoofed X-Forwarded-For gives no fresh budget: the address is the socket', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  for (let n = 1; n <= 30; n++) {
    await world.verify(repository, LOGINS.signer1, { headers: { 'x-forwarded-for': addressOf(n) } });
  }
  const spoofed = await world.verify(repository, LOGINS.signer1, { headers: { 'x-forwarded-for': '203.0.113.200' } });
  expect(spoofed.statusCode).toBe(429);
});

test('with TRUST_PROXY=1 the address the proxy appended is the client: two forwarded clients have a budget each', async () => {
  const world = await publicWorld({ TRUST_PROXY: '1' });
  const repository = world.t1.plain.githubRepoId;
  const first = { headers: { 'x-forwarded-for': addressOf(1) } };
  const second = { headers: { 'x-forwarded-for': addressOf(2) } };
  for (let n = 0; n < 30; n++) {
    expect((await world.verify(repository, LOGINS.signer1, first)).statusCode).toBe(200);
  }
  expect((await world.verify(repository, LOGINS.signer1, first)).statusCode).toBe(429);
  expect((await world.verify(repository, LOGINS.signer1, second)).statusCode).toBe(200);
});

test('with TRUST_PROXY=1 a client cannot choose its address: the part of X-Forwarded-For it wrote itself is not read', async () => {
  const world = await publicWorld({ TRUST_PROXY: '1' });
  const repository = world.t1.plain.githubRepoId;
  for (let n = 1; n <= 30; n++) {
    await world.verify(repository, LOGINS.signer1, { headers: { 'x-forwarded-for': `192.0.2.${n}, ${addressOf(9)}` } });
  }
  const rotated = await world.verify(repository, LOGINS.signer1, {
    headers: { 'x-forwarded-for': `192.0.2.250, ${addressOf(9)}` },
  });
  expect(rotated.statusCode).toBe(429);
});

/** 20 clients that ask 30 times each, so that 600 requests are made and none of the clients is over its own budget. */
async function spendRepositoryBudget(world: PublicWorld, target: { readonly repository: number | string }) {
  const statuses: number[] = [];
  for (let client = 1; client <= 20; client++) {
    statuses.push(...(await callsFrom(world, addressOf(client), 30, target)));
  }
  return statuses;
}

test('the 601st request in a minute for one repository is 429 rate_limited with Retry-After, from an address that has asked for nothing', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  expect(new Set(await spendRepositoryBudget(world, { repository }))).toEqual(new Set([200]));
  const limited = await world.verify(repository, LOGINS.signer1, { remoteAddress: '192.0.2.50' });
  expect(limited.statusCode).toBe(429);
  expect(parsed(limited, errorResponseSchema).error.code).toBe('rate_limited');
  expect(limited.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  expect(limited.headers['access-control-allow-origin']).toBe('*');
  expect(lookups(world)).toBe(1);
});

test('the budget of a repository is its own: another repository, the other tenant included, is answered', async () => {
  const world = await publicWorld();
  const { t1, t2 } = world;
  await spendRepositoryBudget(world, { repository: t1.plain.githubRepoId });
  const other = await world.verify(t2.plain.githubRepoId, LOGINS.signer2, { remoteAddress: '192.0.2.51' });
  expect([other.statusCode, other.body]).toEqual([200, '{"signed":true}']);
});

test('a client over its own budget does not spend the budget of the repository: its refused requests are not counted there', async () => {
  const world = await publicWorld();
  const repository = world.t1.plain.githubRepoId;
  expect(new Set(await callsFrom(world, addressOf(100), 60))).toEqual(new Set([200, 429]));
  for (let client = 1; client <= 19; client++) {
    expect(new Set(await callsFrom(world, addressOf(client), 30)), `client ${client}`).toEqual(new Set([200]));
  }
  const last = await world.verify(repository, LOGINS.signer1, { remoteAddress: '192.0.2.52' });
  expect(last.statusCode).toBe(429);
});

test('every spelling of a repository id that is not one shares one budget of 600, so that made-up ids open no budget of their own', async () => {
  const world = await publicWorld();
  const statuses: number[] = [];
  for (let client = 1; client <= 20; client++) {
    for (let n = 0; n < 30; n++) {
      const response = await world.verify(`made-up-${client}-${n}`, LOGINS.signer1, {
        remoteAddress: addressOf(client),
      });
      statuses.push(response.statusCode);
    }
  }
  expect(new Set(statuses)).toEqual(new Set([400]));
  const next = await world.verify('made-up-last', LOGINS.signer1, { remoteAddress: '192.0.2.53' });
  expect(next.statusCode).toBe(429);
  const real = await world.verify(world.t1.plain.githubRepoId, LOGINS.signer1, { remoteAddress: '192.0.2.53' });
  expect(real.statusCode).toBe(200);
});
