// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../../adapters/db/schema.ts';
import type { Evaluation, EvaluationInput } from '../../domain/evaluation/index.ts';
import type { OrgMembership } from '../org-membership.ts';
import type { Clock } from '../ports/clock.ts';
import type { GitHubClient } from '../ports/github.ts';
import type { EvaluationReporter } from '../ports/reporter.ts';

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
}
