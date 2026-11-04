// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { closePr } from './close-pr/close-pr.ts';
import { evaluatePr } from './evaluate-pr/evaluate-pr.ts';
import type { EvaluatePrPorts } from './evaluate-pr/evaluate-pr-ports.ts';
import type { JobHandler } from './job-registry.ts';
import { recheckComment } from './recheck/recheck-comment.ts';
import { rerunHeadSha } from './recheck/rerun-head-sha.ts';

// The handlers of the jobs that run on the ports of the evaluation and that the deliveries start (E07-S04, E07-S06, E07-S07), as
// `registerHandlers` binds them. Each takes the ports for the signal of the job, and hands the job's envelope and context on.

/** What these jobs run on, for one job: its GitHub client is bound to the `signal` of the job. */
export type EvaluationPorts = (signal: AbortSignal) => EvaluatePrPorts;

/** `evaluate-pr`: the numbers of the payload are keys only, the pull request and the policy are read now (E07-S04). */
export function evaluatePrHandler(ports: EvaluationPorts): JobHandler<'evaluate-pr'> {
  return (job, { signal, attempt, logger, enqueuer, jobId }) =>
    evaluatePr(ports(signal), job, { attempt, logger, enqueuer, jobId });
}

/** `close-pr`: the numbers of the payload are keys only, the state of the pull request is read now (E07-S06). */
export function closePrHandler(ports: EvaluationPorts): JobHandler<'close-pr'> {
  return (job, { signal, logger, pending }) => closePr(ports(signal), job, { logger, pending });
}

/** `recheck-comment`: the comment is fetched, the text of the payload is none (E07-S07). */
export function recheckCommentHandler(ports: EvaluationPorts): JobHandler<'recheck-comment'> {
  return (job, { signal, logger, enqueuer, jobId }) => recheckComment(ports(signal), job, { logger, enqueuer, jobId });
}

/** `evaluate-head-sha`: the open pull requests of the head SHA are asked of GitHub, and each is evaluated again (E07-S07). */
export function evaluateHeadShaHandler(ports: EvaluationPorts): JobHandler<'evaluate-head-sha'> {
  return (job, { signal, logger, enqueuer, jobId }) => rerunHeadSha(ports(signal), job, { logger, enqueuer, jobId });
}
