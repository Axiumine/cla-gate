// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { Secret } from '../../config/secret.ts';
import type { InstallationTokenResponse } from './schemas.ts';

/** A token is used until fewer than this many milliseconds of its hour remain, so it is reused for about 55 minutes. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * The cache never holds more entries than this.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_CACHED_TOKENS = 1000;

export interface CachedToken {
  readonly token: Secret;
  readonly expiresAtMs: number;
}

/** The token of a GitHub answer, held as a {@link Secret} from here on. */
export function toCachedToken(minted: InstallationTokenResponse): CachedToken {
  return { token: new Secret(minted.token), expiresAtMs: Date.parse(minted.expires_at) };
}

/** A token with at least five minutes left. One with less is as good as expired: it is minted again, never served. */
function isReusable(entry: CachedToken, nowMs: number): boolean {
  return entry.expiresAtMs - nowMs >= REFRESH_MARGIN_MS;
}

/**
 * The installation tokens held in memory (E05-S03), one per installation and at most {@link MAX_CACHED_TOKENS}. When
 * the cache is full, tokens that can no longer be used go first (the expired and the ones with less than five minutes
 * left), and only then the oldest. Nothing here is written anywhere: the Map is the only copy of a token.
 */
export class TokenCache {
  /** In mint order: the first key is the oldest token. */
  readonly #entries = new Map<GithubId, CachedToken>();

  /** How many tokens are held, unusable ones included. */
  get size(): number {
    return this.#entries.size;
  }

  /** The token of the installation if it has at least five minutes left. */
  reusable(githubInstallationId: GithubId, nowMs: number): CachedToken | undefined {
    const entry = this.#entries.get(githubInstallationId);
    return entry !== undefined && isReusable(entry, nowMs) ? entry : undefined;
  }

  /** Keeps `entry` as the newest token of the installation, making room first if the cache is full. */
  store(githubInstallationId: GithubId, entry: CachedToken, nowMs: number): void {
    this.#entries.delete(githubInstallationId);
    if (this.#entries.size >= MAX_CACHED_TOKENS) {
      this.#makeRoom(nowMs);
    }
    this.#entries.set(githubInstallationId, entry);
  }

  delete(githubInstallationId: GithubId): void {
    this.#entries.delete(githubInstallationId);
  }

  #makeRoom(nowMs: number): void {
    for (const [id, entry] of this.#entries) {
      if (!isReusable(entry, nowMs)) {
        this.#entries.delete(id);
      }
    }
    for (const id of this.#entries.keys()) {
      if (this.#entries.size < MAX_CACHED_TOKENS) {
        break;
      }
      this.#entries.delete(id);
    }
  }
}
