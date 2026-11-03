// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { unlockResponseSchema } from '../../../../shared/setup.ts';
import { TEST_SETUP_TOKEN } from '../../../config/test-support.ts';
import { type TestApp, type TestAppOptions, testApp } from '../../../test-support.ts';
import { unreachableDatabase } from '../test-support.ts';

// The app in setup mode for the tests of E19-S06, and the two calls every test of the flow makes: the unlock and the manifest.
// Nothing of the setup touches the database, so the app gets one that is never reached.

/** The public address of the instance under test, and so the one `Origin` a setup `POST` may carry. */
export const SETUP_ORIGIN = 'https://cla.example.org';

/** The environment of a server in setup mode: a token and an address, and none of the five GitHub App variables. */
const SETUP_ENV: Readonly<Record<string, string>> = {
  SETUP_TOKEN: TEST_SETUP_TOKEN,
  PUBLIC_BASE_URL: SETUP_ORIGIN,
};

/** The app in setup mode (`env` adds to {@link SETUP_ENV}), closed after the test. */
export function setupApp(options: Omit<TestAppOptions, 'db'> = {}): Promise<TestApp> {
  return testApp({ ...options, env: { ...SETUP_ENV, ...options.env }, db: unreachableDatabase() });
}

/** What an unlock gave the browser: the cookie to send back and the token to send in `x-csrf-token`. */
export interface Unlocked {
  /** The `Cookie` header value: `__Host-cla_setup=<id>`. */
  readonly cookie: string;
  readonly csrfToken: string;
}

/** `POST /api/setup/unlock` with `token` (anything, to try a hostile body), from `address` when one is given. */
export function postUnlock(app: FastifyInstance, token: unknown, address?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/setup/unlock',
    payload: { token },
    ...(address === undefined ? {} : { remoteAddress: address }),
  });
}

/** Unlocks with the token of the test and returns what the browser keeps. A refused unlock fails the test: its answer is not the unlock's. */
export async function unlockSetup(app: FastifyInstance, address?: string): Promise<Unlocked> {
  const response = await postUnlock(app, TEST_SETUP_TOKEN, address);
  const { csrfToken } = unlockResponseSchema.parse(response.json());
  const [cookie] = response.cookies;
  return { cookie: `${cookie?.name}=${cookie?.value}`, csrfToken };
}

/** What a setup `POST` carries when nothing is taken away: the cookie, the CSRF token and the `Origin` of the instance. */
export interface ManifestCall {
  readonly body?: string | object;
  /** Leave a header out with `undefined`, or send another value. */
  readonly origin?: string | undefined;
  readonly cookie?: string | undefined;
  readonly csrfToken?: string | undefined;
}

/** A body the manifest route accepts. */
export const MANIFEST_BODY = {
  ownerType: 'user',
  appName: 'CLA Gate cla-example-org',
  allowOtherAccounts: false,
} as const;

/** `POST /api/setup/manifest` as a browser that unlocked would send it; each part of {@link ManifestCall} can be changed or dropped. */
export function postManifest(app: FastifyInstance, unlocked: Unlocked, call: Partial<ManifestCall> = {}) {
  const headers = {
    origin: 'origin' in call ? call.origin : SETUP_ORIGIN,
    cookie: 'cookie' in call ? call.cookie : unlocked.cookie,
    'x-csrf-token': 'csrfToken' in call ? call.csrfToken : unlocked.csrfToken,
  };
  return app.inject({
    method: 'POST',
    url: '/api/setup/manifest',
    headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)),
    payload: 'body' in call ? call.body : MANIFEST_BODY,
  });
}
