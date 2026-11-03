// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { Clock } from '../ports/clock.ts';
import type { GitHubClient } from '../ports/github.ts';
import { CheckRunReporter } from './check-run-reporter.ts';
import { CheckRunWriter } from './check-run-writer.ts';

// The one place the reporter of the evaluation job (E09-S05) is put together; E09-S06 binds it at boot.

/** What {@link createCheckRunReporter} builds the reporter from: the stores and ports it runs on, and the App it reports as. */
export interface CheckRunReporterWiring {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  /** The numeric id of this App (`GITHUB_APP_ID`). */
  readonly appId: GithubId;
  readonly publicBaseUrl: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The reporter with its writer, on `github` as the App `appId`. */
export function createCheckRunReporter(wiring: CheckRunReporterWiring): CheckRunReporter {
  const { db, github, appId, clock, logger, publicBaseUrl } = wiring;
  return new CheckRunReporter({
    db,
    writer: new CheckRunWriter({ github, appId, clock, logger }),
    publicBaseUrl,
    logger,
  });
}
