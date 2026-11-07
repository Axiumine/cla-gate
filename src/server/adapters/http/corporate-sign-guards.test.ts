// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CORPORATE_AGREEMENTS_PATH } from '../../../shared/corporate.ts';
import {
  bodyFor,
  type CorporateWorld,
  corporateWorld,
  createdOf,
  documentUrl,
  failureOf,
  getAs,
  NOTHING_WRITTEN,
  postAgreement,
  type Signer,
  signerWith,
  watchRows,
} from './corporate-fixture/test-support.ts';

// What stands before the signing (E21-S02): the session, the `Origin` and CSRF checks, the kind and the size of the body, and the
// budget of 10 requests a minute for each person, keyed on the numeric GitHub id and spent only by a request the guards let in.

const BUDGET = 10;

type Headers = Readonly<Record<string, string>>;

/** The headers without the one called `name`. */
function without(headers: Headers, name: string): Headers {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));
}

/** A raw POST with `headers` and `payload`, as a client that skips a step of the sign page would send it. */
function rawPost(world: CorporateWorld, headers: Headers, payload: string) {
  return world.app.inject({ method: 'POST', url: CORPORATE_AGREEMENTS_PATH, headers, payload });
}

/** `count` valid signing requests of `who` in a row, from `address` when one is given. Answers the statuses. */
async function sendRepeatedly(world: CorporateWorld, who: Signer, count: number, address?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let sent = 0; sent < count; sent++) {
    const response = await world.app.inject({
      method: 'POST',
      url: CORPORATE_AGREEMENTS_PATH,
      headers: { ...who.headers, 'content-type': 'application/json' },
      ...(address === undefined ? {} : { remoteAddress: address }),
      payload: JSON.stringify(bodyFor(world.c1)),
    });
    statuses.push(response.statusCode);
  }
  return statuses;
}

test('a request with no session is a 401 and never a redirect', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const response = await rawPost(
    world,
    { origin: world.origin, 'content-type': 'application/json', 'x-csrf-token': world.ada.token },
    JSON.stringify(bodyFor(world.c1)),
  );
  expect(failureOf(response)).toEqual([401, 'unauthorized']);
  expect(response.headers.location).toBeUndefined();
  expect(await written()).toEqual(NOTHING_WRITTEN);
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
])('%s is a 403 and writes nothing', async (_label, change, code) => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const response = await rawPost(
    world,
    { ...change(world.ada.headers), 'content-type': 'application/json' },
    JSON.stringify(bodyFor(world.c1)),
  );
  expect(failureOf(response)).toEqual([403, code]);
  expect(await written()).toEqual(NOTHING_WRITTEN);
});

test('a body that is not JSON is a 415 and a body above 16 KiB a 413 payload_too_large, and nothing is written', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const form = await rawPost(
    world,
    { ...world.ada.headers, 'content-type': 'application/x-www-form-urlencoded' },
    'companyName=Acme',
  );
  expect(form.statusCode).toBe(415);
  const large = await rawPost(
    world,
    { ...world.ada.headers, 'content-type': 'application/json' },
    JSON.stringify(bodyFor(world.c1, { companyName: 'x'.repeat(17_000) })),
  );
  expect(failureOf(large)).toEqual([413, 'payload_too_large']);
  expect(await written()).toEqual(NOTHING_WRITTEN);
});

test('a person may sign 10 times a minute; the 11th is 429 too_many_requests in the standard body, with retry-after', async () => {
  const world = await corporateWorld();
  const allowed = await sendRepeatedly(world, world.ada, BUDGET);
  expect(allowed).toEqual([201, ...Array.from({ length: BUDGET - 1 }, () => 409)]);
  const limited = await postAgreement(world, world.ada, bodyFor(world.c1));
  expect(failureOf(limited)).toEqual([429, 'too_many_requests']);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  expect(limited.headers['x-ratelimit-limit']).toBe('10');
});

test('the budget is the person’s: another person from the same address is not limited, and the same person from another address is', async () => {
  const world = await corporateWorld();
  const eve = await signerWith(world, 4321);
  expect(await sendRepeatedly(world, world.ada, BUDGET, '198.51.100.7')).toHaveLength(BUDGET);
  expect(await sendRepeatedly(world, world.ada, 1, '198.51.100.8')).toEqual([429]);
  expect(await sendRepeatedly(world, eve, 1, '198.51.100.7')).toEqual([201]);
});

test('a request the guards refuse does not spend the budget: ten refused for the token leave all ten to the person', async () => {
  const world = await corporateWorld();
  for (let sent = 0; sent < BUDGET; sent++) {
    const refused = await rawPost(
      world,
      { cookie: world.ada.cookie, origin: world.origin, 'content-type': 'application/json' },
      JSON.stringify(bodyFor(world.c1)),
    );
    expect(refused.statusCode).toBe(403);
  }
  expect(await sendRepeatedly(world, world.ada, BUDGET)).toEqual([
    201,
    ...Array.from({ length: BUDGET - 1 }, () => 409),
  ]);
});

test('a request that fails a check after the guards does spend the budget', async () => {
  const world = await corporateWorld();
  for (let sent = 0; sent < BUDGET; sent++) {
    expect(failureOf(await postAgreement(world, world.ada, bodyFor(world.c1, { companyName: '' })))).toEqual([
      422,
      'validation_failed',
    ]);
  }
  expect((await postAgreement(world, world.ada, bodyFor(world.c1))).statusCode).toBe(429);
});

test('the budget of the signing is not the budget of reading the corporate CLA', async () => {
  const world = await corporateWorld();
  for (let read = 0; read <= BUDGET; read++) {
    expect((await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId))).statusCode).toBe(200);
  }
  createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
});
