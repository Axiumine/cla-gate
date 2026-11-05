// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parsed } from './document-fixture/test-support.ts';
import {
  badgePath,
  LOGINS,
  lookups,
  type PublicWorld,
  publicWorld,
  signerBadgePath,
  signerPath,
} from './public-verification-fixture/test-support.ts';

// The budgets of the badges (E22-S03) are those of GET /api/public/repos/:githubRepoId/signers/:login (E22-S02), and the same buckets: 30 a
// minute for each client address and 600 for each repository, drawn on by the three routes together, not 30 and 600 for each route. Every client
// below has an address in 192.0.2.0/24 or 198.51.100.0/24, which are documentation ranges.

/** The three routes of the public API for the repository, each as the path of one call. */
const routesFor = (world: PublicWorld): readonly string[] => [
  badgePath(world.t1.plain.githubRepoId),
  signerBadgePath(world.t1.plain.githubRepoId, LOGINS.signer1),
  signerPath(world.t1.plain.githubRepoId, LOGINS.signer1),
];

/** The statuses of `count` calls from `address`, spread over the paths in turn. */
async function callsFrom(
  world: PublicWorld,
  address: string,
  count: number,
  paths: readonly string[],
): Promise<number[]> {
  const statuses: number[] = [];
  for (let n = 0; n < count; n++) {
    const response = await world.get(paths[n % paths.length] ?? '', { remoteAddress: address });
    statuses.push(response.statusCode);
  }
  return statuses;
}

/** The address `n` of the documentation range 198.51.100.0/24: `n` from 1 to 254. */
const addressOf = (n: number): string => `198.51.100.${n}`;

test('the 31st request in a minute from one address is 429 rate_limited with Retry-After, whichever of the three routes it goes to', async () => {
  const world = await publicWorld();
  const paths = routesFor(world);
  expect(new Set(await callsFrom(world, '192.0.2.1', 30, paths))).toEqual(new Set([200]));
  for (const path of paths) {
    const limited = await world.get(path, { remoteAddress: '192.0.2.1' });
    expect(limited.statusCode, path).toBe(429);
    expect(parsed(limited, errorResponseSchema).error.code, path).toBe('rate_limited');
    expect(limited.headers['retry-after'], path).toMatch(/^[1-9]\d*$/);
    expect(Number(limited.headers['retry-after']), path).toBeLessThanOrEqual(60);
    expect(limited.headers['access-control-allow-origin'], path).toBe('*');
    expect(limited.headers['cache-control'], path).toBe('no-store');
    expect(limited.headers['content-type'], path).toBe('application/json; charset=utf-8');
    expect(limited.headers['set-cookie'], path).toBeUndefined();
  }
});

test('the badges spend the budget of the client with the JSON call: 15 images and 15 answers leave no room for a 31st of any kind', async () => {
  const world = await publicWorld();
  const { t1 } = world;
  const badges = await callsFrom(world, '192.0.2.2', 15, [signerBadgePath(t1.plain.githubRepoId, LOGINS.signer1)]);
  const answers = await callsFrom(world, '192.0.2.2', 15, [signerPath(t1.plain.githubRepoId, LOGINS.signer1)]);
  expect(new Set([...badges, ...answers])).toEqual(new Set([200]));
  expect(await callsFrom(world, '192.0.2.2', 1, [signerBadgePath(t1.plain.githubRepoId, LOGINS.signer1)])).toEqual([
    429,
  ]);
  expect(await callsFrom(world, '192.0.2.2', 1, [badgePath(t1.plain.githubRepoId)])).toEqual([429]);
  expect(await callsFrom(world, '192.0.2.2', 1, [signerPath(t1.plain.githubRepoId, LOGINS.signer1)])).toEqual([429]);
  expect(await callsFrom(world, '192.0.2.3', 1, [badgePath(t1.plain.githubRepoId)])).toEqual([200]);
});

test('the refusals of the badges spend the budget too: an unknown repository and an invalid input cost a request each', async () => {
  const world = await publicWorld();
  const mixed = [
    ...(await callsFrom(world, '192.0.2.4', 10, [badgePath(987_654)])),
    ...(await callsFrom(world, '192.0.2.4', 10, [badgePath('abc')])),
    ...(await callsFrom(world, '192.0.2.4', 10, [signerBadgePath(world.t1.plain.githubRepoId, LOGINS.signer1)])),
  ];
  expect(mixed).toEqual([
    ...Array.from({ length: 10 }, () => 404),
    ...Array.from({ length: 10 }, () => 400),
    ...Array.from({ length: 10 }, () => 200),
  ]);
  expect(await callsFrom(world, '192.0.2.4', 1, [badgePath(world.t1.plain.githubRepoId)])).toEqual([429]);
});

test('the 429 of a badge is a JSON error and no image, and it carries none of the headers of an image', async () => {
  const world = await publicWorld();
  const path = badgePath(world.t1.plain.githubRepoId);
  await callsFrom(world, '192.0.2.5', 30, [path]);
  const limited = await world.get(path, { remoteAddress: '192.0.2.5' });
  expect(limited.statusCode).toBe(429);
  expect(limited.body).not.toContain('<svg');
  expect(limited.headers['content-security-policy']).not.toContain('sandbox');
  expect(limited.headers['cross-origin-resource-policy']).not.toBe('cross-origin');
});

/** 20 clients that ask 30 times each, spread over the three routes, so that 600 requests are made and none of the clients is over its own budget. */
async function spendRepositoryBudget(world: PublicWorld): Promise<number[]> {
  const statuses: number[] = [];
  for (let client = 1; client <= 20; client++) {
    statuses.push(...(await callsFrom(world, addressOf(client), 30, routesFor(world))));
  }
  return statuses;
}

test('the 601st request in a minute for one repository is 429 on every route, from an address that has asked for nothing: one budget for the three', async () => {
  const world = await publicWorld();
  expect(new Set(await spendRepositoryBudget(world))).toEqual(new Set([200]));
  for (const [index, path] of routesFor(world).entries()) {
    const limited = await world.get(path, { remoteAddress: `192.0.2.${50 + index}` });
    expect(limited.statusCode, path).toBe(429);
    expect(parsed(limited, errorResponseSchema).error.code, path).toBe('rate_limited');
    expect(limited.headers['retry-after'], path).toMatch(/^[1-9]\d*$/);
    expect(limited.headers['access-control-allow-origin'], path).toBe('*');
  }
});

test('the budget of a repository is its own for the badges too: the other tenant is answered when this one has spent it', async () => {
  const world = await publicWorld();
  const { t2 } = world;
  await spendRepositoryBudget(world);
  const project = await world.projectBadge(t2.plain.githubRepoId, { remoteAddress: '192.0.2.60' });
  const signer = await world.signerBadge(t2.plain.githubRepoId, LOGINS.signer2, { remoteAddress: '192.0.2.61' });
  expect([project.statusCode, signer.statusCode]).toEqual([200, 200]);
});

test('every spelling of a repository id that is not one shares one budget of 600 across the badges and the JSON call, so that made-up ids open no budget of their own', async () => {
  const world = await publicWorld();
  const statuses: number[] = [];
  const spellings = [
    (client: number, n: number) => badgePath(`made-up-${client}-${n}`),
    (client: number, n: number) => signerBadgePath(`made-up-${client}-${n}`, LOGINS.signer1),
    (client: number, n: number) => signerPath(`made-up-${client}-${n}`, LOGINS.signer1),
  ];
  for (let client = 1; client <= 20; client++) {
    for (let n = 0; n < 30; n++) {
      const response = await world.get(spellings[n % spellings.length]?.(client, n) ?? '', {
        remoteAddress: addressOf(client),
      });
      statuses.push(response.statusCode);
    }
  }
  expect(new Set(statuses)).toEqual(new Set([400]));
  expect((await world.get(badgePath('made-up-last'), { remoteAddress: '192.0.2.62' })).statusCode).toBe(429);
  expect((await world.projectBadge(world.t1.plain.githubRepoId, { remoteAddress: '192.0.2.62' })).statusCode).toBe(200);
  expect(lookups(world)).toBe(0);
});

test('with TRUST_PROXY=1 two forwarded clients have a budget each on the badges, and with TRUST_PROXY=false a spoofed X-Forwarded-For gives none', async () => {
  const trusted = await publicWorld({ TRUST_PROXY: '1' });
  const path = badgePath(trusted.t1.plain.githubRepoId);
  const first = { headers: { 'x-forwarded-for': addressOf(1) } };
  for (let n = 0; n < 30; n++) {
    expect((await trusted.get(path, first)).statusCode).toBe(200);
  }
  expect((await trusted.get(path, first)).statusCode).toBe(429);
  expect((await trusted.get(path, { headers: { 'x-forwarded-for': addressOf(2) } })).statusCode).toBe(200);
  const direct = await publicWorld();
  const directPath = badgePath(direct.t1.plain.githubRepoId);
  for (let n = 1; n <= 30; n++) {
    await direct.get(directPath, { headers: { 'x-forwarded-for': addressOf(n) } });
  }
  expect((await direct.get(directPath, { headers: { 'x-forwarded-for': '203.0.113.200' } })).statusCode).toBe(429);
});
