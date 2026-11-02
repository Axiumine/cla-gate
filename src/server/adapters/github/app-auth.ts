// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { GitHubPrivateKey } from '../../config/github-key.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { GitHubAuthError } from '../../services/ports/github-errors.ts';
import { signAppJwt } from './app-jwt.ts';

/** A token is reused for less than this long, then minted again. Its `exp` is 540 s after minting: 4 minutes are left. */
const REUSE_MS = 5 * 60 * 1000;

/** At least one key; the first is tried first. */
export type KeyList = readonly [GitHubPrivateKey, ...GitHubPrivateKey[]];

export interface AppAuthOptions {
  /** `GITHUB_APP_ID`: the `iss` claim. */
  readonly appId: string;
  /** In signing order: the current key, then the one kept during a rotation. */
  readonly keys: KeyList;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface MintedJwt {
  readonly token: string;
  readonly mintedAtMs: number;
}

/**
 * How the App proves itself to GitHub (E05-S02): signs the JWT, keeps it for five minutes, and walks the key list when
 * GitHub refuses a key. Nothing here logs or throws a token or a key; only fingerprints are named.
 */
export class AppAuth {
  readonly #appId: string;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #keys: KeyList;
  /** One entry per key, by fingerprint: the token it signed last and when. */
  readonly #minted = new Map<string, MintedJwt>();

  constructor(options: AppAuthOptions) {
    this.#appId = options.appId;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#keys = options.keys;
  }

  /** The JWT of the key that is first in the list now; the same token for less than five minutes, then a new one. */
  createJwt(): string {
    return this.#jwtFor(this.#keys[0]);
  }

  /**
   * Runs `send` with a JWT. `send` reports a 401 by throwing {@link GitHubAuthError}; then the next key is tried, and
   * the key that worked is moved to the front for the calls that follow (one WARN, `github.app_key_fallback`, names its
   * fingerprint). When every key is refused the call fails with a fresh `GitHubAuthError`. Any other error is `send`'s
   * own and passes through.
   */
  async withJwt<T>(send: (jwt: string) => Promise<T>): Promise<T> {
    const keys = this.#keys;
    for (const key of keys) {
      try {
        const result = await send(this.#jwtFor(key));
        this.#promote(key);
        return result;
      } catch (error) {
        if (!(error instanceof GitHubAuthError)) {
          throw error;
        }
      }
    }
    this.#logger.error({ keyFingerprints: keys.map((key) => key.fingerprint) }, 'github.app_keys_refused');
    throw new GitHubAuthError('GitHub refused every App signing key');
  }

  #jwtFor(key: GitHubPrivateKey): string {
    const nowMs = this.#clock.now().getTime();
    const minted = this.#minted.get(key.fingerprint);
    if (minted !== undefined && nowMs - minted.mintedAtMs < REUSE_MS) {
      return minted.token;
    }
    const token = signAppJwt(this.#appId, key, Math.floor(nowMs / 1000));
    this.#minted.set(key.fingerprint, { token, mintedAtMs: nowMs });
    return token;
  }

  /** Moves a key that worked to the front. Concurrent calls that all fell back find it in front already: one WARN. */
  #promote(key: GitHubPrivateKey): void {
    const [first, ...rest] = this.#keys;
    if (key === first) {
      return;
    }
    this.#keys = [key, first, ...rest.filter((other) => other !== key)];
    this.#logger.warn({ keyFingerprint: key.fingerprint }, 'github.app_key_fallback');
  }
}
