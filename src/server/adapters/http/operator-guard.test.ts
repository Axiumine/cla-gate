// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { OPERATOR_INSTALLATIONS_PATH } from '../../../shared/operator.ts';
import { createOperatorPolicies } from '../../services/operator-policies.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';
import { matrixWorld } from './cross-tenant-runner/test-support.ts';
import { shapeOf } from './tenant-guard-fixture/test-support.ts';

// Who gets through the `operator` access kind (E11-S08): the people whose numeric GitHub id the policy names, and nobody
// else. A signed-in person who is not an operator gets the `404` of a route that does not exist, a caller with no session
// the `401` of every protected route.

const LIST = { method: 'GET', url: OPERATOR_INSTALLATIONS_PATH } as const;
const NOWHERE = { method: 'GET', url: '/api/operator/no-such-route' } as const;

// The five people of the two tenants: admin1 31001, admin2 31002, repoAdmin1 31003, member1 31004, outsider 31005.
const OPERATORS = '31005, 31002 ,31005';

test('the people the variable names get the list, however it is spelled, and the other three of the five get the 404 of a route that is not there', async () => {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: OPERATORS });
  const unknown = shapeOf(await world.ask('admin1', NOWHERE));
  expect(unknown.status).toBe(404);
  const answers = await Promise.all(
    (['outsider', 'admin2', 'admin1', 'repoAdmin1', 'member1'] as const).map(async (who) => {
      const response = await world.ask(who, LIST);
      return [who, response.statusCode, response.statusCode === 404 ? shapeOf(response) : null] as const;
    }),
  );
  expect(answers).toEqual([
    ['outsider', 200, null],
    ['admin2', 200, null],
    ['admin1', 404, unknown],
    ['repoAdmin1', 404, unknown],
    ['member1', 404, unknown],
  ]);
});

test('an organisation admin is not an operator: the role GitHub gives in a tenant opens nothing here', async () => {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31005' });
  expect((await world.ask('admin1', LIST)).statusCode).toBe(404);
  expect((await world.ask('admin2', LIST)).statusCode).toBe(404);
});

test('a caller with no session gets 401 unauthorized with the body of every protected route, and no cookie is set', async () => {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31005' });
  const response = await world.ask(null, LIST);
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBeUndefined();
  const { error } = errorResponseSchema.parse(response.json());
  expect([error.code, error.message]).toEqual(['unauthorized', 'Unauthorized']);
  const session = await world.ask(null, { method: 'GET', url: '/api/auth/session' });
  // `/api/auth` adds `no-store` to its answers; the status and the body are the same.
  expect([shapeOf(response).status, shapeOf(response).body]).toEqual([shapeOf(session).status, shapeOf(session).body]);
});

test('a dead session cookie gets 401 and is cleared, as on every protected route', async () => {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31005' });
  const response = await world.app.inject({
    url: OPERATOR_INSTALLATIONS_PATH,
    headers: { cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` },
  });
  expect([response.statusCode, response.headers['set-cookie']]).toEqual([
    401,
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ]);
});

/** A session for a user row that is not one of the five: the id and the login are the test's to choose. */
async function sessionFor(world: Awaited<ReturnType<typeof matrixWorld>>, githubId: number, login: string) {
  const user = await world.db
    .insertInto('users')
    .values({ github_id: githubId, login, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const created = await world.store.create({ userId: user.id }, world.clock.now());
  return { cookie: `${COOKIE_NAME}=${created.id}` };
}

test.each([
  ['the login of the operator, on another id (a recycled login)', 99_001, 'login-31005'],
  ['the numeric id of the operator written as the login', 99_002, '31005'],
])(
  'a person whose login is %s is not the operator: the identity is the id of the session',
  async (_label, githubId, login) => {
    const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31005' });
    const stranger = await sessionFor(world, githubId, login);
    const response = await world.app.inject({ url: OPERATOR_INSTALLATIONS_PATH, headers: stranger });
    expect(response.statusCode).toBe(404);
    const operator = await world.ask('outsider', LIST);
    expect(operator.statusCode).toBe(200);
  },
);

const ids = (...values: number[]) => values.map((value) => parseGithubId(value));
const owner = (id: number, type: string) => () => Promise.resolve({ id: parseGithubId(id), type });

/** The app with the policy a boot would build from `OPERATOR_GITHUB_IDS` and the owner of the App. */
async function policyWorld(configured: number[] | undefined, appOwner: ReturnType<typeof owner> | undefined) {
  const logger = { info: () => undefined };
  const operators = createOperatorPolicies({
    configured: configured === undefined ? undefined : ids(...configured),
    owner: appOwner,
    logger,
  });
  return authWorld({}, { operators });
}

test.each([
  ['an owner that is a user, the variable unset', undefined, owner(9001, 'User'), [200, 404]],
  ['an owner that is an organisation, the variable unset', undefined, owner(9001, 'Organization'), [404, 404]],
  ['an owner that is a user, the variable naming someone else', [4242], owner(9001, 'User'), [404, 200]],
  ['an owner that is an organisation, the variable naming someone', [4242], owner(9001, 'Organization'), [404, 200]],
  ['no GitHub App, the variable unset', undefined, undefined, [404, 404]],
  ['no GitHub App, the variable naming someone', [4242], undefined, [404, 200]],
])('with %s the person 9001 and the person 4242 get %j', async (_label, configured, appOwner, statuses) => {
  const world = await policyWorld(configured, appOwner);
  const people = [await world.login(9001), await world.login(4242)];
  const answers = await Promise.all(
    people.map((person) => world.app.inject({ url: OPERATOR_INSTALLATIONS_PATH, headers: { cookie: person.cookie } })),
  );
  expect(answers.map((response) => response.statusCode)).toEqual(statuses);
});

test('while the owner of the App cannot be told every signed-in person gets 502 github_unavailable, the owner included, and the list is kept back', async () => {
  let up = false;
  const world = await policyWorld(undefined, () =>
    up
      ? Promise.resolve({ id: parseGithubId(9001), type: 'User' })
      : Promise.reject(new GitHubUnavailableError('down')),
  );
  const owner9001 = await world.login(9001);
  const other = await world.login(4242);
  const ask = async (person: { cookie: string }) =>
    world.app.inject({ url: OPERATOR_INSTALLATIONS_PATH, headers: { cookie: person.cookie } });
  const during = [await ask(owner9001), await ask(other)];
  expect(during.map((response) => response.statusCode)).toEqual([502, 502]);
  expect(during.map((response) => errorResponseSchema.parse(response.json()).error.code)).toEqual([
    'github_unavailable',
    'github_unavailable',
  ]);
  up = true;
  expect([(await ask(owner9001)).statusCode, (await ask(other)).statusCode]).toEqual([200, 404]);
});

test('a request that no route answers is a 404 for everyone and asks the policy nothing', async () => {
  let asked = 0;
  const world = await policyWorld(undefined, () => {
    asked += 1;
    return Promise.resolve({ id: parseGithubId(9001), type: 'User' });
  });
  const person = await world.login(9001);
  await world.app.inject({ url: '/api/operator/no-such-route', headers: { cookie: person.cookie } });
  await world.app.inject({ url: '/api/auth/session', headers: { cookie: person.cookie } });
  expect(asked).toBe(0);
});
