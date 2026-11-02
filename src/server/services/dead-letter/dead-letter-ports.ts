// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { Clock } from '../ports/clock.ts';
import type { GitHubClient } from '../ports/github.ts';
import type { EvaluationReporter } from '../ports/reporter.ts';

// The ports the dead-letter handlers of the evaluation jobs run on (E07-S05), and the error of an application that has none.

/** What the handler of a dead evaluation job runs on, for one job: the GitHub client is bound to the signal of the job. */
export interface FailurePorts {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly clock: Clock;
  readonly reporter: EvaluationReporter;
}

/** Builds the {@link FailurePorts} of one job. Throws {@link DeadLetterUnavailableError} when the application has no GitHub App or no reporter. */
export type FailurePortsFor = (signal: AbortSignal) => FailurePorts;

/**
 * The application cannot report a failed evaluation: no GitHub App or no reporter (E09) is configured. The dead-letter job
 * fails and is retried under the same bounds, then logged as `dead_letter_unhandled`, instead of being completed with nothing done.
 */
export class DeadLetterUnavailableError extends Error {
  override readonly name = 'DeadLetterUnavailableError';

  constructor() {
    super('A failed evaluation cannot be reported: no GitHub App or no evaluation reporter is configured');
  }
}
