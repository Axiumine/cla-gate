// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { buildApp } from './app.ts';
import type { GitHubAndDatabase } from './boot-services.ts';
import type { AppConfig } from './config/env.ts';
import type { Clock } from './services/ports/clock.ts';

export interface BootAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock: Clock | undefined;
  readonly fetch: typeof fetch | undefined;
}

/**
 * Builds the app over what start-up opened: the database, the GitHub client of the roles (E11-S05), the verified App
 * identity that `GET /api/meta` reads at each request (E17-S09) and the operator policy (E11-S08).
 */
export function buildBootApp(options: BootAppOptions, started: Pick<GitHubAndDatabase, 'db' | 'github' | 'operators'>) {
  const { db, github, operators } = started;
  const { config, logger, clock, fetch } = options;
  return buildApp({
    config,
    db,
    logger,
    clock,
    fetch,
    github: github?.client,
    appIdentity: github?.identity,
    operators,
  });
}
