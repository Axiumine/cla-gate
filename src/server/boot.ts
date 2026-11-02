// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import type { DestinationStream, Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';
import type { GitHubApp } from './adapters/github/start.ts';
import { createLogger } from './adapters/http/logger.ts';
import { buildApp } from './app.ts';
import type { InstallationWiring } from './boot-installations.ts';
import { startGitHubAndDatabase } from './boot-services.ts';
import { type AppConfig, loadConfig } from './config/env.ts';
import { logGithubApp } from './config/github-app.ts';
import type { Clock } from './services/ports/clock.ts';
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
  /** Where the GitHub App's JWT takes its time from (E05-S02). Defaults to the wall clock. */
  readonly clock?: Clock;
  /** How requests to GitHub are sent (E05-S02). Defaults to the global `fetch`; tests intercept it with MSW. */
  readonly fetch?: typeof fetch;
}

export interface RunningServer extends InstallationWiring {
  /** For example `http://127.0.0.1:3000`. */
  readonly address: string;
  /**
   * Stops accepting connections, drains in-flight requests (their connections are dropped after the shutdown timeout),
   * closes the database. Safe to call more than once: every call returns the same shutdown.
   */
  close(): Promise<void>;
  /** The GitHub App's signer and identity check; undefined when the App id or key is not configured (E05-S02). */
  readonly github: GitHubApp | undefined;
}

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
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
  const started = await startGitHubAndDatabase({
    config,
    logger,
    clock: options.clock,
    fetch: options.fetch,
    createDb: options.createDb,
  });
  if (started === undefined) {
    options.signals.exitCode = 1;
    return undefined;
  }
  const { db, github, ...wiring } = started;
  const app = await buildApp({ config, db, logger });
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    const timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    return { address, close: closeOnSignals(app, logger, options.signals, timeoutMs), github, ...wiring };
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start');
    await app.close();
    options.signals.exitCode = 1;
    return undefined;
  }
}
