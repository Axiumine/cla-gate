// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** How long a shutdown waits for open requests before it drops their connections (typical grace periods are 30 s). */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** The part of `process` that boot() needs: signal subscription and the exit code. Tests pass an EventEmitter. */
export interface ProcessLike {
  on(signal: (typeof SHUTDOWN_SIGNALS)[number], listener: () => void): unknown;
  off(signal: (typeof SHUTDOWN_SIGNALS)[number], listener: () => void): unknown;
  exitCode?: number | string | null | undefined;
}

/**
 * Closes the app on SIGINT or SIGTERM, then lets the event loop drain so the process exits by itself. A request that is
 * still open when the timeout runs out would hold the shutdown (and, once it finishes, an idle keep-alive connection
 * would hold it for another 65 s), so the timeout drops every connection and the exit code becomes 1. A second signal
 * does the same at once: the listeners stay until the shutdown is over, so an impatient operator never falls back to
 * the default action, which would kill the process without closing the database.
 */
export function closeOnSignals(
  app: FastifyInstance,
  logger: Logger,
  signals: ProcessLike,
  timeoutMs: number,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  const dropConnections = (reason: string): void => {
    logger.error(reason);
    signals.exitCode = 1;
    app.server.closeAllConnections();
  };
  const shutdown = async (): Promise<void> => {
    const deadline = setTimeout(() => {
      dropConnections('shutdown deadline exceeded, dropping open connections');
    }, timeoutMs);
    try {
      await app.close();
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      signals.exitCode = 1;
    } finally {
      clearTimeout(deadline);
      for (const signal of SHUTDOWN_SIGNALS) {
        signals.off(signal, onSignal);
      }
    }
  };
  const close = (): Promise<void> => (closing ??= shutdown());
  const onSignal = (): void => {
    if (closing === undefined) {
      logger.info('shutting down');
      void close();
    } else {
      dropConnections('second signal, dropping open connections');
    }
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    signals.on(signal, onSignal);
  }
  return close;
}
