// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import type { JobHandler } from '../job-registry.ts';
import { sweepPolicyChange } from './policy-sweep.ts';
import { type SweepDeps, sweep } from './sweep.ts';
import { sweepInstallation } from './sweep-installation.ts';

// The handlers of the two jobs the scheduler starts (E07-S08) and of the one a change of policy starts (E07-S09), as
// `registerHandlers` binds them.

/** `sweep`: the installations are reconciled and each served one gets a `sweep-installation` job. */
export function sweepHandler(deps: SweepDeps): JobHandler<'sweep'> {
  return (_job, { signal, logger, enqueuer, pending, jobId }) =>
    sweep(deps, { logger, enqueuer, pending, jobId, signal });
}

/**
 * `sweep-installation`: the numbers of the payload are keys only. The open pull requests of the installation are read from
 * GitHub with the ports of the job, whose client is bound to its signal, and the ones without a result are sent to be evaluated.
 */
export function sweepInstallationHandler(
  ports: (signal: AbortSignal) => EvaluatePrPorts,
): JobHandler<'sweep-installation'> {
  return (job, { signal, logger, enqueuer, pending, jobId }) =>
    sweepInstallation(ports(signal), job, { logger, enqueuer, pending, jobId, signal });
}

/**
 * `sweep-repository`: the numbers of the payload are keys only. The open pull requests of the repository are read from
 * GitHub with the ports of the job, whose client is bound to its signal, and each is sent to be evaluated again.
 */
export function sweepRepositoryHandler(
  ports: (signal: AbortSignal) => EvaluatePrPorts,
): JobHandler<'sweep-repository'> {
  return (job, { signal, logger, enqueuer, jobId }) =>
    sweepPolicyChange(ports(signal), job, { logger, enqueuer, jobId });
}
