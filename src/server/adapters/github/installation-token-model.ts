// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { Secret } from '../../config/secret.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { InstallationGate } from '../../services/ports/installation-gate.ts';
import type { CachedToken } from './token-cache.ts';

/** Runs a request with an App JWT: `GitHubApp.withJwt` (E05-S02), which verifies the App's identity and walks the keys. */
type WithJwt = <T>(send: (jwt: string) => Promise<T>) => Promise<T>;

/** An installation access token and the moment GitHub stops accepting it. */
export interface InstallationToken {
  /** A {@link Secret}: printing it, in any way, gives `[REDACTED]`. Only the caller that sends it calls `reveal()`. */
  readonly token: Secret;
  readonly expiresAt: Date;
}

export interface InstallationTokensOptions {
  readonly withJwt: WithJwt;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  /** Decides which installations are served (E05-S07). Without one every installation is refused. */
  readonly gate?: InstallationGate | undefined;
}

/** The caller's view of a cached token. */
export function present(entry: CachedToken): InstallationToken {
  return { token: entry.token, expiresAt: new Date(entry.expiresAtMs) };
}
