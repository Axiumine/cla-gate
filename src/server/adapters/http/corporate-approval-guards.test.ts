// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  type ApprovalWorld,
  approvalsUrl,
  approvalUrl,
  approvalWorld,
  carryOverUrl,
  stateOf,
} from './corporate-approval-fixture/test-support.ts';
import { failureOf, getAs, type Signer } from './corporate-fixture/test-support.ts';

// What stands before the three routes that change approvals (E21-S03): the session, the `Origin` and CSRF checks, the kind and the size
// of the body, and the budget of 60 requests a minute for each person, keyed on the numeric GitHub id and spent only by a request the
// guards let in. A request the guards refuse writes nothing and asks GitHub nothing.

const BUDGET = 60;

type Headers = Readonly<Record<string, string>>;

/** One request of each of the three routes, with a body that would be valid. */
function changes(world: ApprovalWorld) {
  return {
    add: { method: 'POST', url: approvalsUrl(world.adas.id), body: { kind: 'email_domain', domain: 'acme.com' } },
    revoke: { method: 'DELETE', url: approvalUrl(world.adas.id, 1), body: { reason: 'left' } },
    carryOver: { method: 'POST', url: carryOverUrl(world.adas.id), body: { fromAgreementId: 1 } },
  } as const;
}

type Change = ReturnType<typeof changes>[keyof ReturnType<typeof changes>];

/** The headers without the one called `name`. */
function without(headers: Headers, name: string): Headers {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));
}

/** A raw request with `headers` and `payload`, as a client that skips a step of the page would send it. */
function raw(world: ApprovalWorld, change: Change, headers: Headers, payload: string) {
  return world.app.inject({ method: change.method, url: change.url, headers, payload });
}

/** The statuses of `count` requests of `change` in a row by `who`, from `address` when one is given. */
async function sendRepeatedly(
  world: ApprovalWorld,
  who: Signer,
  send: { readonly change: Change; readonly count: number; readonly address?: string },
): Promise<number[]> {
  const { change, count, address } = send;
  const statuses: number[] = [];
  for (let sent = 0; sent < count; sent++) {
    const response = await world.app.inject({
      method: change.method,
      url: change.url.replace(`/${world.adas.id}/`, '/987654/'),
      headers: { ...who.headers, 'content-type': 'application/json' },
      ...(address === undefined ? {} : { remoteAddress: address }),
      payload: JSON.stringify(change.body),
    });
    statuses.push(response.statusCode);
  }
  return statuses;
}

test('a request with no session is a 401 and never a redirect, on every route', async () => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  for (const change of Object.values(changes(world))) {
    const response = await raw(
      world,
      change,
      { origin: world.origin, 'content-type': 'application/json', 'x-csrf-token': world.ada.token },
      JSON.stringify(change.body),
    );
    expect(failureOf(response), change.url).toEqual([401, 'unauthorized']);
    expect(response.headers.location).toBeUndefined();
  }
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
])('%s is a 403 on every route, and nothing is looked up or written', async (_label, change, code) => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  for (const request of Object.values(changes(world))) {
    const response = await raw(
      world,
      request,
      { ...change(world.ada.headers), 'content-type': 'application/json' },
      JSON.stringify(request.body),
    );
    expect(failureOf(response), request.url).toEqual([403, code]);
  }
  expect(world.github.calls).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});

test('a body that is not JSON is a 415 and a body above 16 KiB a 413 payload_too_large, on every route', async () => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  for (const change of Object.values(changes(world))) {
    const form = await raw(
      world,
      change,
      { ...world.ada.headers, 'content-type': 'application/x-www-form-urlencoded' },
      'kind=email_domain',
    );
    expect(form.statusCode, change.url).toBe(415);
    const large = await raw(
      world,
      change,
      { ...world.ada.headers, 'content-type': 'application/json' },
      JSON.stringify({ ...change.body, reason: 'x'.repeat(17_000) }),
    );
    expect(failureOf(large), change.url).toEqual([413, 'payload_too_large']);
  }
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['adding', (all: ReturnType<typeof changes>) => all.add],
  ['revoking', (all: ReturnType<typeof changes>) => all.revoke],
  ['copying', (all: ReturnType<typeof changes>) => all.carryOver],
])(
  'a person may change approvals 60 times a minute by %s; the 61st is 429 too_many_requests with retry-after',
  async (_label, choose) => {
    const world = await approvalWorld();
    const change = choose(changes(world));
    const allowed = await sendRepeatedly(world, world.ada, { change, count: BUDGET });
    expect(new Set(allowed)).toEqual(new Set([404]));
    const limited = await world.app.inject({
      method: change.method,
      url: change.url.replace(`/${world.adas.id}/`, '/987654/'),
      headers: { ...world.ada.headers, 'content-type': 'application/json' },
      payload: JSON.stringify(change.body),
    });
    expect(failureOf(limited)).toEqual([429, 'too_many_requests']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(limited.headers['x-ratelimit-limit']).toBe('60');
  },
);

test('the budget is the person’s: another person from the same address is not limited, and the same person from another address is', async () => {
  const world = await approvalWorld();
  const { add: change } = changes(world);
  await sendRepeatedly(world, world.ada, { change, count: BUDGET, address: '198.51.100.7' });
  expect(await sendRepeatedly(world, world.ada, { change, count: 1, address: '198.51.100.8' })).toEqual([429]);
  expect(await sendRepeatedly(world, world.bob, { change, count: 1, address: '198.51.100.7' })).toEqual([404]);
});

test('a request the guards refuse does not spend the budget: 60 refused for the token leave all 60 to the person', async () => {
  const world = await approvalWorld();
  const { add: change } = changes(world);
  for (let sent = 0; sent < BUDGET; sent++) {
    const refused = await raw(
      world,
      change,
      { cookie: world.ada.cookie, origin: world.origin, 'content-type': 'application/json' },
      JSON.stringify(change.body),
    );
    expect(refused.statusCode).toBe(403);
  }
  expect(new Set(await sendRepeatedly(world, world.ada, { change, count: BUDGET }))).toEqual(new Set([404]));
});

test('reading the list has no budget of this kind: 61 reads in a row all succeed', async () => {
  const world = await approvalWorld();
  for (let read = 0; read <= BUDGET; read++) {
    expect((await getAs(world, world.ada, approvalsUrl(world.adas.id))).statusCode).toBe(200);
  }
});
