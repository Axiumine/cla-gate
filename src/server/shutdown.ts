// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { JobQueue } from './services/ports/jobs.ts';

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
 * would hold it for another 65 s), so the timeout drops every connection and the exit code becomes 1. The timeout is
 * about the requests only: once the HTTP server has closed, the jobs that run get their own grace period (the queue's,
 * E07-S03) before the database is closed. A second signal drops the connections at once: the listeners stay until the
 * shutdown is over, so an impatient operator never falls back to the default action, which would kill the process
 * without closing the database.
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
    app.server.once('close', () => {
      clearTimeout(deadline);
    });
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

/**
 * `queue` with a stop that ends the process with exit code 1 when the shutdown had to abort running jobs (E07-S03): a clean
 * drain leaves the exit code alone, which is 0. The aborted jobs are failed by the queue and run again after a restart,
 * so nothing is lost; the exit code tells the operator that the grace period was too short for a job.
 */
export function failExitOnAbortedStop(queue: JobQueue, logger: Logger, signals: ProcessLike): JobQueue {
  return {
    enqueuer: queue.enqueuer,
    isReady: () => queue.isReady(),
    async stop() {
      const outcome = await queue.stop();
      if (outcome === 'aborted') {
        logger.error('jobs still running at the end of the grace period were aborted, and run again after a restart');
        signals.exitCode = 1;
      }
      return outcome;
    },
  };
}
