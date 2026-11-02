// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { createPgDatabase } from './adapters/db/pg.ts';
import type { Database } from './adapters/db/schema.ts';
import { type GitHubApp, startGitHubOrLog } from './adapters/github/start.ts';
import { type InstallationWiring, wireInstallations } from './boot-installations.ts';
import type { AppConfig } from './config/env.ts';
import { LateBoundGate } from './services/installation-gate.ts';
import type { Clock } from './services/ports/clock.ts';

export interface GitHubAndDatabaseOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch | undefined;
  /** Opens the database, after the GitHub App has started. Defaults to node-postgres on `DATABASE_URL`. */
  readonly createDb?: ((config: AppConfig, logger: Logger) => Kysely<Database> | Promise<Kysely<Database>>) | undefined;
}

export interface GitHubAndDatabase extends InstallationWiring {
  readonly db: Kysely<Database>;
  /** Undefined when the App id or key is not configured (E05-S01). */
  readonly github: GitHubApp | undefined;
}

function createPgDb(config: AppConfig, logger: Logger): Kysely<Database> {
  return createPgDatabase({ connectionString: config.databaseUrl.reveal(), onError: logger.error.bind(logger) });
}

/**
 * Starts the GitHub App, opens the database and wires the two together. The self-check of the App (E05-S02) comes first
 * and a failure that retrying cannot repair ends here with nothing opened (the failure is logged by
 * {@link startGitHubOrLog}); the installation gate is therefore handed to the App closed and bound once the database is
 * there.
 * @returns undefined after a fatal failure.
 */
export async function startGitHubAndDatabase(
  options: GitHubAndDatabaseOptions,
): Promise<GitHubAndDatabase | undefined> {
  const { config, logger, clock, fetch } = options;
  const gate = new LateBoundGate();
  const started = await startGitHubOrLog({ config, logger, clock, fetch, gate });
  if (started === undefined) {
    return undefined;
  }
  const db = await (options.createDb ?? createPgDb)(config, logger);
  const wiring = await wireInstallations({ db, config, logger, clock, gate, app: started.app });
  return { ...wiring, db, github: started.app };
}
