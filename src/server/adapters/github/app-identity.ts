// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { ConfigError } from '../../config/env.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { APP_ROUTE, fetchApp } from './app-api.ts';
import type { AppAuth } from './app-auth.ts';
import { type AppIdentity, toAppIdentity } from './app-identity-model.ts';
import type { RateLimiter } from './rate-limiter.ts';

export interface AppIdentityCheckOptions {
  readonly auth: AppAuth;
  /** `GITHUB_APP_ID`: GitHub's answer has to agree with it. */
  readonly appId: string;
  readonly logger: Logger;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  readonly clock: Clock;
  /** The rate limiter of the GitHub client (E05-S05): `GET /app` runs in the App's lane like every JWT request. */
  readonly limiter: RateLimiter;
}

/**
 * The self-check of the App's identity (E05-S02): `GET /app` with a JWT must return the `id` in `GITHUB_APP_ID`. A
 * mismatch is a configuration error (a key that belongs to another App), thrown as a {@link ConfigError} naming only
 * the variable. The identity is kept once verified; until then every {@link verify} asks again, so an outage at start-up
 * is repaired by the first real use. Concurrent callers share one request.
 */
export class AppIdentityCheck {
  readonly #options: AppIdentityCheckOptions;
  #verified: AppIdentity | undefined;
  #pending: Promise<AppIdentity> | undefined;

  constructor(options: AppIdentityCheckOptions) {
    this.#options = options;
  }

  /** The verified identity, or undefined while the check has not succeeded. */
  current(): AppIdentity | undefined {
    return this.#verified;
  }

  /**
   * Resolves with the verified identity, asking GitHub only if no check has succeeded yet. Every GitHub call of the
   * platform awaits it first, so the check is repeated lazily after a start-up outage.
   * @throws ConfigError (id mismatch), GitHubAuthError, GitHubUnavailableError or GitHubResponseError; a failure is not kept.
   */
  verify(): Promise<AppIdentity> {
    if (this.#verified !== undefined) {
      return Promise.resolve(this.#verified);
    }
    this.#pending ??= this.#check().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #check(): Promise<AppIdentity> {
    const { auth, appId, logger, fetch: request, timeoutMs, clock, limiter } = this.#options;
    const app = await auth.withJwt((jwt) =>
      limiter.run('app', APP_ROUTE, () => fetchApp(request, jwt, timeoutMs, clock)),
    );
    // Compared as numbers: the id is digits only (E05-S01), and a GitHub id is a safe integer.
    if (app.id !== Number(appId)) {
      logger.error({ configuredAppId: appId, githubAppId: app.id }, 'github.app_id_mismatch');
      throw new ConfigError(['GITHUB_APP_ID']);
    }
    const identity = toAppIdentity(app);
    this.#verified = identity;
    logger.info({ appId: identity.appId, slug: identity.slug, ownerId: identity.ownerId }, 'github.app_verified');
    return identity;
  }
}
