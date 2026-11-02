// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/env.ts';
import { type Clock, systemClock } from '../../services/ports/clock.ts';
import { GitHubAuthError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { AppAuth, type KeyList } from './app-auth.ts';
import { AppIdentityCheck } from './app-identity.ts';

/** How long the self-check waits for GitHub: start-up does not hang on a black hole. */
const SELF_CHECK_TIMEOUT_MS = 10_000;

/** The App's credentials and what GitHub said about it. The services of later stories take it from the boot. */
export interface GitHubApp {
  /** The verified identity, once GitHub has answered the self-check. */
  readonly identity: AppIdentityCheck;
  /**
   * Runs `send` with an App JWT (see {@link AppAuth.withJwt}: key fallback, `GitHubAuthError` when every key is refused),
   * after the identity is verified. The self-check that a GitHub outage skipped at start-up is therefore repeated by
   * the first request made as the App, and not again once it has succeeded; if it still fails, `send` is not called.
   * Every request that needs the App's JWT goes through here, so none can precede the check.
   */
  withJwt<T>(send: (jwt: string) => Promise<T>): Promise<T>;
}

/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
export interface GitHubStartOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly fetch: typeof fetch;
  /** Defaults to 10 s. */
  readonly timeoutMs?: number;
}

/**
 * Builds the App's signer and runs the start-up self-check (E05-S02): `GET /app` with a JWT. A 401 is fatal in
 * production and a WARN elsewhere; a network failure, a timeout or a 5xx is a WARN everywhere (the instance starts
 * and the check is repeated on the first GitHub use); a wrong App id, an answer without an owner and anything
 * unforeseen are fatal.
 * @returns undefined when the App id or the key is not configured: the adapter is simply not built (E05-S01).
 * @throws ConfigError naming GITHUB_APP_ID, GitHubAuthError (production), GitHubResponseError.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); the boot calls {@link startGitHubOrLog}.
 */
export async function startGitHubApp(options: GitHubStartOptions): Promise<GitHubApp | undefined> {
  const { config, logger } = options;
  const { appId, privateKey, previousPrivateKey } = config.github;
  if (appId === undefined || privateKey === undefined) {
    return undefined;
  }
  const keys: KeyList = previousPrivateKey === undefined ? [privateKey] : [privateKey, previousPrivateKey];
  const auth = new AppAuth({ appId, keys, clock: options.clock, logger });
  const identity = new AppIdentityCheck({
    auth,
    appId,
    logger,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? SELF_CHECK_TIMEOUT_MS,
  });
  try {
    await identity.verify();
  } catch (error) {
    const outage = error instanceof GitHubUnavailableError;
    const refused = error instanceof GitHubAuthError && config.nodeEnv !== 'production';
    if (!outage && !refused) {
      throw error;
    }
    logger.warn({ err: error }, 'github.app_check_deferred');
  }
  return {
    identity,
    withJwt: async (send) => {
      await identity.verify();
      return auth.withJwt(send);
    },
  };
}

export interface BootGitHubOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch | undefined;
}

/**
 * {@link startGitHubApp} for the boot: a failure that retrying cannot repair is logged (`github.app_check_failed`, fatal)
 * and ends in undefined; nothing else has been opened yet.
 * @returns undefined after a fatal failure; otherwise the App, which is itself undefined when none is configured.
 */
export async function startGitHubOrLog(
  options: BootGitHubOptions,
): Promise<{ readonly app: GitHubApp | undefined } | undefined> {
  const { config, logger } = options;
  try {
    const app = await startGitHubApp({
      config,
      logger,
      clock: options.clock ?? systemClock,
      fetch: options.fetch ?? fetch,
    });
    return { app };
  } catch (error) {
    logger.fatal({ err: error }, 'github.app_check_failed');
    return undefined;
  }
}
