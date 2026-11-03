// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { parseGithubId } from '../shared/github-id.ts';
import type { Database } from './adapters/db/schema.ts';
import type { JobWorkersOptions } from './boot-jobs.ts';
import type { AppConfig } from './config/env.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import type { GitHubClient } from './services/ports/github.ts';
import { createCheckRunReporter } from './services/reporting/create-check-run-reporter.ts';

// What the `evaluate-pr` job and the dead-letter handlers write to GitHub with (E09-S06): the client of the App and the Check Run
// reporter built on it. Without an App there is nothing to report to, and the jobs that need it fail and retry until there is.

export interface EvaluationWiringOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: Kysely<Database>;
  /** The client of the configured App; undefined when no App id or key is configured. */
  readonly github: GitHubClient | undefined;
  /** Defaults to the wall clock. */
  readonly clock: Clock | undefined;
}

/**
 * The GitHub client and the reporter of the evaluation jobs, or undefined when the application has no GitHub App, or its id is
 * not a number GitHub could have given (the start-up self-check refuses such an id the first time GitHub is asked).
 */
export function evaluationWiring(options: EvaluationWiringOptions): JobWorkersOptions['evaluation'] {
  const { config, logger, db, github } = options;
  const appId = Number(config.github.appId ?? '');
  if (github === undefined || !Number.isSafeInteger(appId) || appId < 1) {
    return undefined;
  }
  const reporter = createCheckRunReporter({
    db,
    github,
    appId: parseGithubId(appId),
    publicBaseUrl: config.publicBaseUrl,
    clock: options.clock ?? systemClock,
    logger,
  });
  return { github, reporter };
}
