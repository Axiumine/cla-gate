// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { RoleCache } from '../../services/role-cache.ts';
import { roleKey } from '../../services/role-fixture/test-support.ts';
import { repoScope } from '../../services/role-key.ts';
import { FakeClock } from '../../services/test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';

// Logout forgets the roles cached for the caller (E11-S04, the call site in the handler of E10-S06 that logs
// `auth.logout`): the real application, a real cache, and the answers it holds before and after.

/** A world whose cache holds an answer for each person, in two installations and for one repository of the first. */
async function world() {
  const base = await authWorld({}, { roleCache: new RoleCache({ clock: new FakeClock('2026-11-02T10:00:00.000Z') }) });
  const loads: string[] = [];
  const keys = (githubId: number) => [
    roleKey(1, githubId),
    roleKey(2, githubId),
    roleKey(1, githubId, repoScope(parseGithubId(77))),
  ];
  /** Asks for every key of the person; a key that is not cached is loaded, and shows in `loads`. */
  const ask = async (githubId: number): Promise<void> => {
    for (const key of keys(githubId)) {
      await base.app.roleCache.resolve(key, () => {
        loads.push(`${key.viewerGithubId}/${key.installationId}/${key.scope}`);
        return Promise.resolve(true);
      });
    }
  };
  return { ...base, ask, loads };
}

const logout = (headers: Record<string, string>, payload?: object) => ({
  method: 'POST' as const,
  url: '/api/auth/logout',
  headers,
  ...(payload === undefined ? {} : { payload }),
});

test('a plain logout forgets everything cached for the caller, in every installation and scope, and nothing of anyone else', async () => {
  const { app, ask, loads, login } = await world();
  const alice = await login(1001);
  await ask(1001);
  await ask(2002);
  expect(loads).toHaveLength(6);
  expect((await app.inject(logout(alice.headers))).statusCode).toBe(204);
  loads.length = 0;
  await ask(2002);
  expect(loads).toEqual([]);
  await ask(1001);
  expect(loads).toEqual(['1001/1/org', '1001/2/org', '1001/1/repo:77']);
});

test('everywhere forgets them too', async () => {
  const { app, ask, loads, login } = await world();
  const alice = await login(1001);
  await login(1001);
  await ask(1001);
  loads.length = 0;
  expect((await app.inject(logout(alice.headers, { everywhere: true }))).statusCode).toBe(204);
  await ask(1001);
  expect(loads).toHaveLength(3);
});

test('a logout that is refused forgets nothing: no session, no token and another site all stop before the handler', async () => {
  const { app, ask, loads, login } = await world();
  const alice = await login(1001);
  await ask(1001);
  loads.length = 0;
  const refused = [
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: alice.headers.origin } }),
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: alice.cookie, origin: alice.headers.origin },
    }),
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...alice.headers, origin: 'https://evil.example' },
    }),
  ];
  expect(refused.map((response) => response.statusCode)).toEqual([401, 403, 403]);
  await ask(1001);
  expect(loads).toEqual([]);
});

test('a body that names another person is refused and neither person loses anything: the identity is the session, never the body', async () => {
  const { app, ask, loads, login } = await world();
  const alice = await login(1001);
  await login(2002);
  await ask(1001);
  await ask(2002);
  loads.length = 0;
  const response = await app.inject(logout(alice.headers, { everywhere: true, userId: 2002, githubId: 2002 }));
  expect(response.statusCode).toBe(400);
  await ask(1001);
  await ask(2002);
  expect(loads).toEqual([]);
});
