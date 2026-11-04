// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../../adapters/db/schema.ts';
import type { Evaluation, EvaluationInput } from '../../domain/evaluation/index.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { OrgMembership } from '../org-membership.ts';
import type { Clock } from '../ports/clock.ts';
import type { GitHubClient } from '../ports/github.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import type { EvaluationReporter } from '../ports/reporter.ts';
import type { Resolved } from './evaluation-tenant.ts';

// What the `evaluate-pr` job is given (E07-S04): the ports of a run, and what the queue tells the run about itself.

/** What the job is made of: its stores, its GitHub client (bound to the signal of the job), the engine and the reporter. */
export interface EvaluatePrPorts {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly clock: Clock;
  readonly orgMembership: OrgMembership;
  readonly reporter: EvaluationReporter;
  /** The engine of E08, `evaluatePullRequest`; a stub in the tests of the protocol. */
  readonly evaluate: (input: EvaluationInput) => Evaluation;
}

/** What the job needs of its run beyond the envelope. */
export interface EvaluatePrContext {
  /** How often the job was retried before this run: 0 for the first. */
  readonly attempt: number;
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** Where the job sends the `finalise-check` job when it finds the repository switched off (E14-S04), on the connection of a transaction it opens. */
  readonly enqueuer: JobEnqueuer;
  /** The id of the running job, which names its sends. */
  readonly jobId: string;
}

/** What every step of one run of the job shares (E07-S04): its ports, the job, the repository as settled by step 1, and the run's context. */
export interface EvaluateRun {
  readonly ports: EvaluatePrPorts;
  readonly job: EnvelopeOf<'evaluate-pr'>;
  readonly resolved: Resolved;
  readonly context: EvaluatePrContext;
}
