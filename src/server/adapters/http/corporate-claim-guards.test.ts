// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { stateOf } from './corporate-approval-fixture/test-support.ts';
import {
  approveDomain,
  claimAs,
  claimOf,
  claimsUrl,
  claimWorld,
  employee,
} from './corporate-claim-fixture/test-support.ts';
import { failureOf, type Signer } from './corporate-fixture/test-support.ts';

// What stands before the claim (E21-S04): the session, the `Origin` and CSRF checks, the kind and the size of the body, the plain-digit id in
// the path, and the budget of 10 claims an hour for each person, keyed on the numeric GitHub id and spent only by a request the guards let in.

const EMMA = 7101;
const BUDGET = 10;
const UNKNOWN_REPOSITORY = 987_654;

type Headers = Readonly<Record<string, string>>;

/** The headers without the one called `name`. */
const without = (headers: Headers, name: string): Headers =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));

/** A raw claim with `headers` and `payload`, as a client that skips a step of the page would send it. */
function raw(world: Awaited<ReturnType<typeof claimWorld>>, headers: Headers, payload: string, url?: string) {
  return world.app.inject({
    method: 'POST',
    url: url ?? claimsUrl(world.t1.plain.githubRepoId),
    headers,
    payload,
  });
}

/** The statuses of `count` claims in a row by `who` for a repository that does not exist, from `address` when one is given. */
async function claimRepeatedly(
  world: Awaited<ReturnType<typeof claimWorld>>,
  who: Signer,
  send: { readonly count: number; readonly address?: string },
): Promise<number[]> {
  const statuses: number[] = [];
  for (let sent = 0; sent < send.count; sent++) {
    const response = await world.app.inject({
      method: 'POST',
      url: claimsUrl(UNKNOWN_REPOSITORY),
      headers: { ...who.headers, 'content-type': 'application/json' },
      ...(send.address === undefined ? {} : { remoteAddress: send.address }),
      payload: JSON.stringify({ confirm: true }),
    });
    statuses.push(response.statusCode);
  }
  return statuses;
}

test('a claim with no session is a 401 and never a redirect, and writes and asks nothing', async () => {
  const world = await claimWorld();
  await approveDomain(world, 'acme.example');
  const before = await stateOf(world.db);
  const response = await raw(
    world,
    { origin: world.origin, 'content-type': 'application/json', 'x-csrf-token': world.ada.token },
    '{"confirm":true}',
  );
  expect(failureOf(response)).toEqual([401, 'unauthorized']);
  expect(response.headers.location).toBeUndefined();
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['no Origin header', (headers: Headers) => without(headers, 'origin'), 'origin_not_allowed'],
  [
    'the Origin of another site',
    (headers: Headers) => ({ ...headers, origin: 'https://evil.example' }),
    'origin_not_allowed',
  ],
  ['no CSRF token', (headers: Headers) => without(headers, 'x-csrf-token'), 'csrf_invalid'],
  [
    'the CSRF token of another session',
    (headers: Headers) => ({ ...headers, 'x-csrf-token': 'x'.repeat(43) }),
    'csrf_invalid',
  ],
])('%s is a 403, and nothing is looked up or written', async (_label, change, code) => {
  const world = await claimWorld();
  await approveDomain(world, 'acme.example');
  const emma = await employee(world, EMMA);
  const before = await stateOf(world.db);
  const calls = world.github.calls.length;
  const response = await raw(
    world,
    { ...change(emma.headers), 'content-type': 'application/json' },
    '{"confirm":true}',
  );
  expect(failureOf(response)).toEqual([403, code]);
  expect(world.github.calls).toHaveLength(calls);
  expect(await stateOf(world.db)).toEqual(before);
});

test('a body that is not JSON is a 415, one above 16 KiB a 413 payload_too_large', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  const form = await raw(
    world,
    { ...emma.headers, 'content-type': 'application/x-www-form-urlencoded' },
    'confirm=true',
  );
  expect(form.statusCode).toBe(415);
  const large = await raw(
    world,
    { ...emma.headers, 'content-type': 'application/json' },
    JSON.stringify({ confirm: true, pad: 'x'.repeat(17_000) }),
  );
  expect(failureOf(large)).toEqual([413, 'payload_too_large']);
});

test.each([
  ['no confirmation', {}],
  ['a confirmation that is false', { confirm: false }],
  ['a confirmation that is text', { confirm: 'true' }],
  ['a key the schema does not know', { confirm: true, repositoryId: 1 }],
  ['a list', [true]],
  ['null', null],
])('%s is a 400 bad_request, after the guards, and writes nothing', async (_label, body) => {
  const world = await claimWorld();
  await approveDomain(world, 'acme.example');
  const emma = await employee(world, EMMA);
  const before = await stateOf(world.db);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId, body))).toEqual([400, 'bad_request']);
  expect(await stateOf(world.db)).toEqual(before);
});

test.each(['0', '01', '1e3', '-4', 'abc', '1.5'])('the id %s in the path is a 400 bad_request', async (id) => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  expect(failureOf(await claimAs(world, emma, id))).toEqual([400, 'bad_request']);
});

test('a person may claim 10 times an hour; the 11th is 429 too_many_requests with retry-after', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  expect(new Set(await claimRepeatedly(world, emma, { count: BUDGET }))).toEqual(new Set([404]));
  const limited = await world.app.inject({
    method: 'POST',
    url: claimsUrl(UNKNOWN_REPOSITORY),
    headers: { ...emma.headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ confirm: true }),
  });
  expect(failureOf(limited)).toEqual([429, 'too_many_requests']);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(60);
  expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(3600);
  expect(limited.headers['x-ratelimit-limit']).toBe('10');
});

test("the budget is the person's: another person from the same address is not limited, and the same person from another address is", async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  await claimRepeatedly(world, emma, { count: BUDGET, address: '198.51.100.7' });
  expect(await claimRepeatedly(world, emma, { count: 1, address: '198.51.100.8' })).toEqual([429]);
  expect(await claimRepeatedly(world, world.bob, { count: 1, address: '198.51.100.7' })).toEqual([404]);
});

test('a claim the guards refuse does not spend the budget: 10 refused for the token leave all 10 to the person', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  for (let sent = 0; sent < BUDGET; sent++) {
    const refused = await raw(
      world,
      { cookie: emma.cookie, origin: world.origin, 'content-type': 'application/json' },
      '{"confirm":true}',
    );
    expect(refused.statusCode).toBe(403);
  }
  expect(new Set(await claimRepeatedly(world, emma, { count: BUDGET }))).toEqual(new Set([404]));
});

test('reading the availability has no budget: 11 reads in a row all succeed', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  for (let read = 0; read <= BUDGET; read++) {
    expect(
      (
        await world.app.inject({
          method: 'GET',
          url: `/api/corporate/repositories/${world.t1.plain.githubRepoId}/availability`,
          headers: { cookie: emma.cookie },
        })
      ).statusCode,
    ).toBe(200);
  }
});

test('the claim answers are never cached', async () => {
  const world = await claimWorld();
  await approveDomain(world, 'acme.example');
  const emma = await employee(world, EMMA);
  const response = await claimAs(world, emma, world.t1.plain.githubRepoId);
  expect(claimOf(response)).toEqual([201, 'covered']);
  expect(response.headers['cache-control']).toBe('no-store');
});
