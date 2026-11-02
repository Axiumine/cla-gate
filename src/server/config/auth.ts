// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { AppConfig } from './env.ts';
import type { Secret } from './secret.ts';

/** Everything the login routes need (E10-S01): present only when all three secrets are configured. */
export interface AuthSettings {
  readonly sessionSecret: Secret;
  /** The GitHub App's client id (not a secret: it is in the authorize URL). */
  readonly clientId: string;
  readonly clientSecret: Secret;
  readonly session: AppConfig['session'];
}

/**
 * The login settings, or undefined when `SESSION_SECRET`, `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is missing. The
 * auth routes are registered only when this answers, the pattern the GitHub adapter uses for the App credentials
 * (E05-S01), so a development or test server without them still starts. Production cannot reach the undefined case:
 * `loadConfig` refuses it.
 */
export function authSettings(config: AppConfig): AuthSettings | undefined {
  const { sessionSecret, session } = config;
  const { clientId, clientSecret } = config.github;
  if (sessionSecret === undefined || clientId === undefined || clientSecret === undefined) {
    return undefined;
  }
  return { sessionSecret, clientId, clientSecret, session };
}

/**
 * Says at start-up whether login is configured: the session lifetimes when it is, else the NAMES of the variables that
 * are missing (never a value). One missing variable out of three is probably a mistake and logs a warning; none at all
 * is a plain development setup.
 */
export function logAuth(logger: Logger, config: AppConfig): void {
  if (authSettings(config) !== undefined) {
    logger.info({ ...config.session }, 'auth.configured');
    return;
  }
  const missing = [
    ...(config.sessionSecret === undefined ? ['SESSION_SECRET'] : []),
    ...(config.github.clientId === undefined ? ['GITHUB_CLIENT_ID'] : []),
    ...(config.github.clientSecret === undefined ? ['GITHUB_CLIENT_SECRET'] : []),
  ];
  logger[missing.length === 3 ? 'info' : 'warn']({ missing }, 'auth.not_configured');
}
