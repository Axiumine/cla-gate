// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { HandlerRegistry, type JobOutcome } from '../job-registry.ts';
import type { Clock } from '../ports/clock.ts';
import type { GitHubClient } from '../ports/github.ts';
import type { EvaluationReporter } from '../ports/reporter.ts';
import { deadEvaluatePr } from './dead-letter-evaluation.ts';
import { deadEvaluateHeadSha } from './dead-letter-head-sha.ts';
import { DeadLetterUnavailableError, type FailurePortsFor } from './dead-letter-ports.ts';
import { deadSyncInstallation } from './dead-letter-sync.ts';

// What a job that died does, by job type (E07-S05): the dead-letter table. It is a handler registry like the one of the
// workers, so a job type without a row is a compile-time hole in `JobHandler` and a test (`dead-letter-registry.test.ts`)
// fails until a type the catalogue gains has its row (E07-S09 adds its three).

/** What the dead-letter handlers run on, besides the clock: the database, and the GitHub-facing ports of a job. */
export interface DeadLetterPorts {
  readonly db: Kysely<Database>;
  /**
   * The GitHub client (bound to the signal of the job) and the reporter that complete the Check Run of a dead evaluation
   * (E09). Undefined when the application has no GitHub App or no reporter: those dead-letter jobs then fail and retry.
   */
  readonly evaluation:
    | ((signal: AbortSignal) => { readonly github: GitHubClient; readonly reporter: EvaluationReporter })
    | undefined;
}

/** A dead job that only needs to be seen: the wrapper logs it at error, and nothing else is done. */
const loggedOnly = (): Promise<JobOutcome> => Promise.resolve({ outcome: 'logged' });

function failurePortsFor(ports: DeadLetterPorts, clock: Clock): FailurePortsFor {
  return (signal) => {
    if (ports.evaluation === undefined) {
      throw new DeadLetterUnavailableError();
    }
    return { db: ports.db, clock, ...ports.evaluation(signal) };
  };
}

/**
 * The dead-letter table: `evaluate-pr` and `evaluate-head-sha` complete their Check Run as `failure` (and set the row),
 * `sync-installation` leaves an audit row, and `recheck-comment`, `close-pr`, `sweep`, `sweep-installation` and
 * `revoke-user-sessions` are only logged at error: the next `/recheck`, close, sweep or revocation repeats the work.
 */
export function deadLetterRegistry(ports: DeadLetterPorts, clock: Clock): HandlerRegistry {
  const registry = new HandlerRegistry();
  const portsFor = failurePortsFor(ports, clock);
  registry.register('evaluate-pr', deadEvaluatePr(portsFor));
  registry.register('evaluate-head-sha', deadEvaluateHeadSha(portsFor));
  registry.register('sync-installation', deadSyncInstallation(ports.db));
  registry.register('close-pr', loggedOnly);
  registry.register('recheck-comment', loggedOnly);
  registry.register('sweep', loggedOnly);
  registry.register('sweep-installation', loggedOnly);
  registry.register('revoke-user-sessions', loggedOnly);
  return registry;
}
