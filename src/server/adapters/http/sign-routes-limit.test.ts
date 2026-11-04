// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGN_PATH } from '../../../shared/sign.ts';
import { errorCodeOf } from './sign-context-fixture/test-support.ts';
import { bodyFor, postSign, type Signer, signerWith, signingWorld } from './sign-fixture/test-support.ts';

// The budget of the sign request (E13-S04): 10 requests a minute for each signed-in person, keyed on the numeric GitHub id of the
// session and not on the address, and spent only by a request the guards let in. The 11th is a 429 with a retry-after.

const BUDGET = 10;

type World = Awaited<ReturnType<typeof signingWorld>>['world'];

/** `count` sign requests of `who` in a row, from `address` when one is given, each with a different name. Answers the statuses. */
async function sendRepeatedly(world: World, who: Signer, count: number, address?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let sent = 0; sent < count; sent++) {
    const response = await world.app.inject({
      method: 'POST',
      url: SIGN_PATH,
      headers: { ...who.headers, 'content-type': 'application/json' },
      ...(address === undefined ? {} : { remoteAddress: address }),
      payload: JSON.stringify({ ...signBody(world), name: `Ada ${sent}` }),
    });
    statuses.push(response.statusCode);
  }
  return statuses;
}

const signBody = (world: World) => bodyFor(world.t1, 1);

test('a person may sign 10 times a minute; the 11th is 429 too_many_requests in the standard body, with retry-after', async () => {
  const { world, ada } = await signingWorld();
  const allowed = await sendRepeatedly(world, ada, BUDGET);
  expect(allowed).toEqual([201, ...Array.from({ length: BUDGET - 1 }, () => 200)]);
  const limited = await postSign(world, ada, signBody(world));
  expect([limited.statusCode, errorCodeOf(limited)]).toEqual([429, 'too_many_requests']);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  expect(limited.headers['x-ratelimit-limit']).toBe('10');
});

test('the budget is the person’s: another person from the same address is not limited, and the same person from another address is', async () => {
  const { world, ada } = await signingWorld();
  const eve = await signerWith(world, 4321);
  expect(await sendRepeatedly(world, ada, BUDGET, '198.51.100.7')).toHaveLength(BUDGET);
  expect(await sendRepeatedly(world, ada, 1, '198.51.100.8')).toEqual([429]);
  expect(await sendRepeatedly(world, eve, 1, '198.51.100.7')).toEqual([201]);
});

test('a request the guards refuse does not spend the budget: ten refused for the token leave all ten to the person', async () => {
  const { world, ada } = await signingWorld();
  for (let sent = 0; sent < BUDGET; sent++) {
    const refused = await world.app.inject({
      method: 'POST',
      url: SIGN_PATH,
      headers: { cookie: ada.cookie, origin: world.origin, 'content-type': 'application/json' },
      payload: JSON.stringify(signBody(world)),
    });
    expect(refused.statusCode).toBe(403);
  }
  expect(await sendRepeatedly(world, ada, BUDGET)).toEqual([201, ...Array.from({ length: BUDGET - 1 }, () => 200)]);
});

test('a request that fails a check after the guards does spend the budget', async () => {
  const { world, ada } = await signingWorld();
  for (let sent = 0; sent < BUDGET; sent++) {
    const refused = await postSign(world, ada, { ...signBody(world), consentTextId: 'individual-v0' });
    expect(refused.statusCode).toBe(409);
  }
  expect((await postSign(world, ada, signBody(world))).statusCode).toBe(429);
});

test('the budget of the sign request is not the budget of reading the sign page', async () => {
  const { world, ada } = await signingWorld();
  await sendRepeatedly(world, ada, BUDGET + 1);
  const page = await world.ask(ada, 9000);
  expect(page.statusCode).toBe(200);
});
