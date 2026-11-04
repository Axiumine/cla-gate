// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { manifestResponseSchema } from '../../../shared/setup.ts';
import { callbackUrl } from '../../config/auth.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp, testConfig } from '../../test-support.ts';
import { postManifest, SETUP_ORIGIN, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S06: the manifest sends GitHub to the routes the application really registers. The paths are read from the route table
// of an application with the login configured, where the webhook and the callback of the login are routes.

test('the webhook URL of the manifest ends with the path of the registered webhook route', async () => {
  const configured = await testApp({ env: AUTH_ENV });
  const webhook = configured.app.routeAccess.find((entry) => entry.access === 'webhook');
  expect(webhook?.method).toBe('POST');
  const { app } = await setupApp();
  const { manifest } = manifestResponseSchema.parse((await postManifest(app, await unlockSetup(app))).json());
  expect(webhook?.url).toBeDefined();
  expect(manifest.hook_attributes.url).toBe(`${SETUP_ORIGIN}${webhook?.url}`);
  expect(manifest.hook_attributes.url.endsWith(webhook?.url ?? 'no webhook route')).toBe(true);
});

test('every callback URL of the manifest is the registered callback route of the login, and the Callback URL the login sends', async () => {
  const configured = await testApp({ env: AUTH_ENV });
  const callbacks = configured.app.routeAccess.filter(
    (entry) => entry.method === 'GET' && entry.url.endsWith('/callback'),
  );
  expect(callbacks.map((entry) => entry.url)).toEqual(['/api/auth/callback']);
  const { app } = await setupApp();
  const { manifest } = manifestResponseSchema.parse((await postManifest(app, await unlockSetup(app))).json());
  expect(manifest.callback_urls).toEqual(callbacks.map((entry) => `${SETUP_ORIGIN}${entry.url}`));
  expect(manifest.callback_urls).toEqual([callbackUrl(testConfig({ PUBLIC_BASE_URL: SETUP_ORIGIN }))]);
});

test('the redirect URL of the manifest is a page of the app, which the server serves in setup mode only', async () => {
  const { app } = await setupApp();
  const { manifest } = manifestResponseSchema.parse((await postManifest(app, await unlockSetup(app))).json());
  const redirect = new URL(manifest.redirect_url);
  expect(redirect.origin).toBe(SETUP_ORIGIN);
  expect(redirect.pathname).toBe('/setup/callback');
  expect(app.routeAccess.some((entry) => entry.url === redirect.pathname)).toBe(false);
});
