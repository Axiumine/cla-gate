// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/env.ts';
import { type Clock, systemClock } from '../../services/ports/clock.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import { GitHubAuthError, GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import type { InstallationGate } from '../../services/ports/installation-gate.ts';
import { AppAuth, type KeyList } from './app-auth.ts';
import { AppIdentityCheck } from './app-identity.ts';
import { InstallationTokens } from './installation-tokens.ts';
import { OctokitGitHubClient } from './octokit-client.ts';
import { createOctokit } from './octokit-transport.ts';
import { RateLimiter } from './rate-limiter.ts';

/** How long a request to GitHub waits for the answer: start-up and the first use do not hang on a black hole. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long one attempt of a call of the client (the reads of the evaluation, the writes of the report) waits for the
 * answer (E07-S10): a job is waiting for it, and the call is repeated twice after a timeout, so a slow answer is given up on early.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CLIENT_TIMEOUT_MS = 5000;

/** The two timeouts of an App: for the self-check and the token requests, and for the calls of the client. A test's `timeoutMs` sets both. */
function timeoutsOf(timeoutMs: number | undefined): { readonly app: number; readonly client: number } {
  return { app: timeoutMs ?? REQUEST_TIMEOUT_MS, client: timeoutMs ?? CLIENT_TIMEOUT_MS };
}

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
  /** The installation access tokens (E05-S03): they refuse every installation until a gate is wired. */
  readonly installationTokens: InstallationTokens;
  /** The only door to GitHub for the services (E05-S04): the Octokit adapter of the GitHub client port. */
  readonly client: GitHubClient;
}

/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
export interface GitHubStartOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly fetch: typeof fetch;
  /** How long a request to GitHub waits; defaults to 10 s for the self-check and the token requests and to 5 s for the calls of the client. */
  readonly timeoutMs?: number;
  /** Which installations get a token (E05-S03, E05-S07). Without one the token provider refuses every installation. */
  readonly gate?: InstallationGate;
}

/**
 * Builds the App's signer and runs the start-up self-check (E05-S02): `GET /app` with a JWT. A 401 is fatal in
 * production and a WARN elsewhere; a network failure, a timeout, a 5xx or a rate limit is a WARN everywhere (the instance
 * starts and the check is repeated on the first GitHub use); a wrong App id, an answer without an owner and anything
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
  const timeouts = timeoutsOf(options.timeoutMs);
  const limiter = new RateLimiter({ clock: options.clock, logger });
  // What the identity check and the token provider both need to send a request through the rate limiter.
  const http = { fetch: options.fetch, timeoutMs: timeouts.app, clock: options.clock, limiter, logger };
  const identity = new AppIdentityCheck({ auth, appId, ...http });
  try {
    await identity.verify();
  } catch (error) {
    // A limit too long to wait out is no verdict on the App either: the check is repeated by the first use.
    const outage = error instanceof GitHubUnavailableError || error instanceof GitHubRateLimitedError;
    const refused = error instanceof GitHubAuthError && config.nodeEnv !== 'production';
    if (!outage && !refused) {
      throw error;
    }
    logger.warn({ err: error }, 'github.app_check_deferred');
  }
  const withJwt: GitHubApp['withJwt'] = async (send) => {
    await identity.verify();
    return auth.withJwt(send);
  };
  const installationTokens = new InstallationTokens({ withJwt, gate: options.gate, ...http });
  const octokit = createOctokit({ fetch: options.fetch, timeoutMs: timeouts.client, logger });
  const client = new OctokitGitHubClient({ octokit, withJwt, tokens: installationTokens, limiter });
  return { identity, withJwt, installationTokens, client };
}

export interface BootGitHubOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch | undefined;
  /** Which installations get a token (E05-S07): the boot passes a gate that is bound to the stored installations later. */
  readonly gate: InstallationGate;
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
      gate: options.gate,
    });
    return { app };
  } catch (error) {
    logger.fatal({ err: error }, 'github.app_check_failed');
    return undefined;
  }
}
