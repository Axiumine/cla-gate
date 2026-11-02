// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Env, variable } from '../ci/lib/env.ts';
import { LOOPBACK, PORT_MAX, PORT_MIN } from '../ci/lib/ports.ts';

// E20-S06: what playwright.config.ts decides, kept here so that it is tested (the config file itself is outside the
// coverage scope). Nothing in this module reads a repository secret: the application under test gets throw-away values.

/** No `{platform}`: a baseline comes from the one pinned container, so it must not be looked up per operating system. */
export const SNAPSHOT_PATH_TEMPLATE = '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}';

/** Explicit on purpose: a changed default must never loosen the visual comparison. */
export const MAX_DIFF_PIXELS = 20;

/** `1` inside the pinned Playwright container (yarn e2e:update and the `e2e` CI job set it), unset everywhere else. */
export const CONTAINER_VARIABLE = 'E2E_CONTAINER';

/**
 * The port of the application under test. The main process picks it and writes it back to its environment, because every
 * Playwright worker loads the config file again and must see the same `baseURL`.
 */
export const PORT_VARIABLE = 'E2E_PORT';

export function isInContainer(env: Env): boolean {
  return variable(env, CONTAINER_VARIABLE) === '1';
}

/** `CI` set to anything but the empty string, as every CI system does. */
export function isCi(env: Env): boolean {
  return variable(env, 'CI') !== '';
}

/** The port already chosen for this run when it is a valid one, else a fresh random free one (above 32768). */
export async function serverPort(env: Env, pickPort: () => Promise<number>): Promise<number> {
  const given = variable(env, PORT_VARIABLE);
  const port = Number(given);
  // The text must be the canonical spelling of the number: Number() alone also accepts ' 40000', '4e4' and '0x9c40'.
  const usable = Number.isInteger(port) && String(port) === given && port >= PORT_MIN && port <= PORT_MAX;
  return usable ? port : pickPort();
}

/** Variables the application reads that hold a secret or identify a GitHub App: always replaced, never inherited. */
const THROWAWAY_SECRETS: readonly string[] = ['SESSION_SECRET', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_SECRET'];
const PLACEHOLDERS: Readonly<Record<string, string>> = { GITHUB_CLIENT_ID: 'e2e-client-id' };
/**
 * Set to the empty string, which the configuration reads as "not set": the application then starts without a GitHub App
 * and makes no request to GitHub (a made-up App id or key would fail the identity check at start-up), and nothing is
 * inherited from the developer's shell.
 */
const BLANKED: readonly string[] = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
  'GITHUB_ALLOWED_ACCOUNT_IDS',
  'OPERATOR_GITHUB_IDS',
  'GITHUB_WEBHOOK_SECRET_PREVIOUS',
];
const SECRET_BYTES = 32;

export interface AppEnvironmentOptions {
  readonly env: Env;
  readonly port: number;
  readonly randomHex: (bytes: number) => string;
}

/**
 * The environment of `yarn start` under test: loopback only, the port of this run, the database of the job, and fresh
 * random secrets. Playwright adds this to the process environment, so every secret and GitHub App variable is set here
 * even though it is optional today: a real value in the developer's shell must never reach the test server.
 */
export function appEnvironment(options: AppEnvironmentOptions): Record<string, string> {
  const secrets = THROWAWAY_SECRETS.map((name) => [name, options.randomHex(SECRET_BYTES)] as const);
  return {
    NODE_ENV: 'test',
    HOST: LOOPBACK,
    PORT: String(options.port),
    LOG_LEVEL: 'warn',
    PUBLIC_BASE_URL: `http://${LOOPBACK}:${options.port}`,
    DATABASE_URL: variable(options.env, 'DATABASE_URL'),
    ...PLACEHOLDERS,
    ...Object.fromEntries(BLANKED.map((name) => [name, ''])),
    ...Object.fromEntries(secrets),
  };
}
