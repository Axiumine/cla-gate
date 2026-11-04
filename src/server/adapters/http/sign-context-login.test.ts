// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedTenant } from '../db/test-support.ts';
import { callbackWorld, setCookies } from './callback-fixture/test-support.ts';
import { contextOf, errorCodeOf, repoIdOf, serveTenant } from './sign-context-fixture/test-support.ts';

// The login round trip of a visitor who follows a sign link (E13-S02). The API never redirects: a visitor without a session gets
// a `401`, and the page starts the login with a relative `return_to` that is the sign path and its `pr` only. E10 checks that
// value again and sends the person back to it, and the session the login made reads the context with the verified addresses
// GitHub reported at that login, which is all the sign page offers: no user token is stored, so nothing is asked again.

const SESSION_COOKIE = /^(__Host-cla_session=[A-Za-z0-9_-]{43});/u;

test.each([
  ['the sign link of a pull request', `/sign/${repoIdOf(1)}?pr=45`, '?pr=45', 45],
  ['the sign page opened from the dashboard', `/sign/${repoIdOf(1)}`, '', null],
])(
  'a visitor on %s is told 401, logs in, comes back to the same page and reads the context',
  async (_what, returnTo, query, pr) => {
    const world = await callbackWorld();
    await serveTenant(world.db, await seedTenant(world.db, 1));
    const url = `/api/sign/${repoIdOf(1)}${query}`;
    const refused = await world.app.inject({ url });
    expect(refused.statusCode).toBe(401);
    expect(errorCodeOf(refused)).toBe('unauthorized');
    expect(refused.headers.location).toBeUndefined();
    const { response } = await world.signIn({ returnTo });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(returnTo);
    const cookie = SESSION_COOKIE.exec(setCookies(response)[1] ?? '')?.[1] ?? '';
    const context = contextOf(await world.app.inject({ url, headers: { cookie } }));
    expect(context).toMatchObject({
      viewer: { githubId: 1001, login: 'alice' },
      emails: [
        { email: 'alice@example.org', primary: true },
        { email: 'alice.work@example.org', primary: false },
      ],
      pr,
      canSign: true,
    });
    expect(JSON.stringify(context)).not.toContain('alice.old@example.org');
  },
);

test.each([
  ['a host', 'https://evil.example/sign/9000?pr=45'],
  ['a protocol-relative address', '//evil.example/sign/9000'],
  ['a backslash', '/\\evil.example/sign/9000'],
])('a return_to with %s does not send the person away from the site after the login', async (_what, returnTo) => {
  const world = await callbackWorld();
  const { response } = await world.signIn({ returnTo });
  expect(response.headers.location).toBe('/');
});
