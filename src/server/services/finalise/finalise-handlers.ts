// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import type { JobHandler } from '../job-registry.ts';
import { finaliseCheck } from './finalise-check.ts';
import { finaliseRepository } from './finalise-repository.ts';

// The handlers of the two jobs that follow turning enforcement off (E14-S04), as `registerHandlers` binds them.

/**
 * `finalise-repository`: the numbers of the payload are keys only. The pull requests of the repository whose latest evaluation is
 * pending or red are read from the database, and a `finalise-check` job is sent for each. The job makes no GitHub call, but it is
 * bound with the ports of the evaluation jobs so that it fails closed, like them, where there is no GitHub App.
 */
export function finaliseRepositoryHandler(
  ports: (signal: AbortSignal) => EvaluatePrPorts,
): JobHandler<'finalise-repository'> {
  return (job, { signal, logger, enqueuer, jobId }) =>
    finaliseRepository(ports(signal), job, { logger, enqueuer, jobId });
}

/**
 * `finalise-check`: the numbers of the payload are keys only. The pull request is read from GitHub with the ports of the job,
 * whose client is bound to its signal, and its Check Run is completed `neutral`.
 */
export function finaliseCheckHandler(ports: (signal: AbortSignal) => EvaluatePrPorts): JobHandler<'finalise-check'> {
  return (job, { signal, logger, enqueuer, jobId }) => finaliseCheck(ports(signal), job, { logger, enqueuer, jobId });
}
