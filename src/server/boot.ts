// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import type { DestinationStream, Logger } from 'pino';
import { createPgDatabase } from './adapters/db/pg.ts';
import type { Database } from './adapters/db/schema.ts';
import { createLogger } from './adapters/http/logger.ts';
import { buildApp } from './app.ts';
import { type AppConfig, loadConfig } from './config/env.ts';
import { logGithubApp } from './config/github-app.ts';
import { closeOnSignals, DEFAULT_SHUTDOWN_TIMEOUT_MS, type ProcessLike } from './shutdown.ts';

export interface BootOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signals: ProcessLike;
  /** Defaults to node-postgres on `DATABASE_URL`. Tests pass PGlite. */
  readonly createDb?: (config: AppConfig, logger: Logger) => Kysely<Database> | Promise<Kysely<Database>>;
  /** Where an invalid configuration is reported. Defaults to stderr. */
  readonly err?: (line: string) => void;
  /** Where the log lines go. Defaults to stdout; tests pass a capture. */
  readonly logDestination?: DestinationStream;
  /** Milliseconds a shutdown waits for open requests before it drops their connections. Defaults to 10 s. */
  readonly shutdownTimeoutMs?: number;
}

export interface RunningServer {
  /** For example `http://127.0.0.1:3000`. */
  readonly address: string;
  /**
   * Stops accepting connections, drains in-flight requests (their connections are dropped after the shutdown timeout),
   * closes the database. Safe to call more than once: every call returns the same shutdown.
   */
  close(): Promise<void>;
}

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function createPgDb(config: AppConfig, logger: Logger): Kysely<Database> {
  return createPgDatabase({ connectionString: config.databaseUrl.reveal(), onError: logger.error.bind(logger) });
}

/**
 * Loads the configuration, connects, listens and installs the signal handlers. An invalid configuration or a port
 * that cannot be bound is reported, sets the exit code to 1 and returns undefined; nothing is left running.
 */
export async function boot(options: BootOptions): Promise<RunningServer | undefined> {
  let config: AppConfig;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    (options.err ?? writeStderr)(String(error));
    options.signals.exitCode = 1;
    return undefined;
  }
  const logger = createLogger(config, options.logDestination);
  logGithubApp(logger, config.github);
  const db = await (options.createDb ?? createPgDb)(config, logger);
  const app = await buildApp({ config, db, logger });
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    const timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    return { address, close: closeOnSignals(app, logger, options.signals, timeoutMs) };
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start');
    await app.close();
    options.signals.exitCode = 1;
    return undefined;
  }
}
