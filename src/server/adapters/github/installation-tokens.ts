// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { closedGate, type InstallationGate } from '../../services/ports/installation-gate.ts';
import { mintInstallationToken } from './installation-token-api.ts';
import { type InstallationToken, type InstallationTokensOptions, present } from './installation-token-model.ts';
import { SingleFlight } from './single-flight.ts';
import { type CachedToken, TokenCache, toCachedToken } from './token-cache.ts';

/**
 * The installation access tokens the platform acts with (E05-S03): minted from the App JWT, kept in memory per
 * installation, replaced when less than five minutes remain. Concurrent requests for one installation share one mint
 * (single flight); installations never wait on each other. A failure is never cached. Tokens exist in this Map and
 * nowhere else: no column, no file, no log line (only the installation id and the expiry are logged).
 */
export class InstallationTokens {
  readonly #options: InstallationTokensOptions;
  readonly #gate: InstallationGate;
  readonly #cache = new TokenCache();
  readonly #mints = new SingleFlight<GithubId, CachedToken>();

  constructor(options: InstallationTokensOptions) {
    this.#options = options;
    this.#gate = options.gate ?? closedGate;
  }

  /** How many tokens are held, unusable ones included. */
  get size(): number {
    return this.#cache.size;
  }

  /**
   * A token for the installation: the cached one while it has five minutes left, otherwise a new one.
   * @throws InstallationNotAdmittedError when the gate refuses the installation (before any request, and the cached
   * token is dropped), InstallationGoneError (404), InstallationSuspendedError (403, suspended), GitHubAuthError (401
   * for every key), GitHubUnavailableError or GitHubResponseError.
   */
  async get(githubInstallationId: GithubId): Promise<InstallationToken> {
    try {
      await this.#gate.assertAdmitted(githubInstallationId);
    } catch (error) {
      this.#cache.delete(githubInstallationId);
      throw error;
    }
    const cached = this.#cache.reusable(githubInstallationId, this.#nowMs());
    if (cached !== undefined) {
      return present(cached);
    }
    return present(await this.#mints.run(githubInstallationId, () => this.#mint(githubInstallationId)));
  }

  /** Drops the token, so the next {@link get} mints one. The client calls it after a 401 made with a cached token (E05-S04). */
  invalidate(githubInstallationId: GithubId): void {
    this.#cache.delete(githubInstallationId);
  }

  #nowMs(): number {
    return this.#options.clock.now().getTime();
  }

  async #mint(githubInstallationId: GithubId): Promise<CachedToken> {
    const { withJwt, fetch: request, timeoutMs, logger } = this.#options;
    try {
      const minted = await withJwt((jwt) => mintInstallationToken(request, jwt, githubInstallationId, timeoutMs));
      const entry = toCachedToken(minted);
      this.#cache.store(githubInstallationId, entry, this.#nowMs());
      logger.info(
        { installationId: githubInstallationId, expiresAt: minted.expires_at },
        'github.installation_token_minted',
      );
      return entry;
    } catch (error) {
      // Whatever was cached for the installation is on its way out (or gone: 404), and a failure is not remembered.
      this.#cache.delete(githubInstallationId);
      throw error;
    }
  }
}
