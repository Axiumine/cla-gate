// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { logAuth } from './auth.ts';
import type { AppConfig } from './env.ts';
import { logGithubApp } from './github-app.ts';

/**
 * Says at start-up which mode the server runs in (E19-S02). A `SETUP_TOKEN` that is set while the GitHub App is configured
 * is ignored, and the line says so by name: the token is only for the first-run flow, and one left in the environment is a
 * credential nobody needs. Never the value.
 */
function logMode(logger: Logger, config: Pick<AppConfig, 'mode' | 'setupTokenIgnored'>): void {
  logger.info({ mode: config.mode }, 'config.mode');
  if (config.setupTokenIgnored) {
    logger.warn({ variable: 'SETUP_TOKEN' }, 'SETUP_TOKEN is ignored while a GitHub App is configured; remove it');
  }
}

/**
 * What the configuration says at start-up, in this order: the mode (E19-S02), whether the GitHub App is configured (E05-S01)
 * and whether the login is (E10-S01). One call from `boot`, which stays inside the complexity score of the FTA gate.
 */
export function logConfiguration(logger: Logger, config: AppConfig): void {
  logMode(logger, config);
  logGithubApp(logger, config.github);
  logAuth(logger, config);
}
