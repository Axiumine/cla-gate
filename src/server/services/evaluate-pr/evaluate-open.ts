// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { toStoredDetails } from '../../domain/evaluation/index.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { JobOutcome } from '../job-registry.ts';
import type { GitHubPullRequest } from '../ports/github.ts';
import type { ReportTarget } from '../ports/reporter.ts';
import { collectCommits } from './commit-listing.ts';
import { displayNamesOf } from './display-names.ts';
import { handOverIfOff, publishAndHandOver } from './enforcement-guard.ts';
import type { EvaluateRun } from './evaluate-pr-ports.ts';
import { readEvaluationInput, type Tenant } from './evaluation-facts.ts';
import { type EvaluationKey, finishEvaluation, startEvaluation } from './evaluation-rows.ts';
import type { Resolved } from './evaluation-tenant.ts';

// Steps 3 to 8 of the `evaluate-pr` job (E07-S04), for a pull request that is open: the row in progress and the report that
// it began, the commits, the facts, the engine, and the second look at the pull request that decides whether the verdict is
// written.

type Job = EnvelopeOf<'evaluate-pr'>;

/** The key of the row of `pr` at its head SHA: the unique key of the table, with the tenant. */
export function evaluationKey(tenant: Tenant, job: Job, pr: GitHubPullRequest): EvaluationKey {
  return {
    installationId: tenant.installation.id,
    repositoryId: tenant.repository.id,
    prNumber: job.prNumber,
    headSha: pr.headSha,
  };
}

/** The pull request is not what the job started on: a push moved its head, or it was closed. */
const moved = (latest: GitHubPullRequest | null, pr: GitHubPullRequest): boolean =>
  latest?.state !== 'open' || latest.headSha !== pr.headSha;

/** The target of the reports: what they are about, and the row they belong to. */
function targetOf(job: Job, resolved: Resolved, pr: GitHubPullRequest, evaluationId: number): ReportTarget {
  return {
    githubInstallationId: job.githubInstallationId,
    githubRepoId: job.githubRepoId,
    fullName: resolved.fullName,
    prNumber: job.prNumber,
    headSha: pr.headSha,
    trigger: job.trigger,
    evaluationId,
  };
}

/** Steps 3 to 8 for a pull request that is open and whose head is `pr.headSha`. */
export async function evaluateOpen(run: EvaluateRun, pr: GitHubPullRequest): Promise<JobOutcome> {
  const { ports, job, resolved } = run;
  const { logger } = run.context;
  const { installation } = resolved.tenant;
  const target = targetOf(
    job,
    resolved,
    pr,
    await startEvaluation(ports.db, evaluationKey(resolved.tenant, job, pr), pr.state),
  );
  await ports.reporter.started(target);
  const collected = await collectCommits(
    { github: ports.github, githubInstallationId: job.githubInstallationId, fullName: resolved.fullName },
    pr,
  );
  if (collected.kind === 'superseded') {
    return superseded(logger);
  }
  const request = { githubInstallationId: job.githubInstallationId, tenant: resolved.tenant, pr, listed: collected };
  const evaluation = ports.evaluate(await readEvaluationInput(ports, request));
  const latest = await ports.github.getPullRequest(job.githubInstallationId, resolved.fullName, job.prNumber);
  if (moved(latest, pr)) {
    return superseded(logger);
  }
  await finishEvaluation(ports.db, installation.id, target.evaluationId, toStoredDetails(evaluation));
  if (await handOverIfOff(run)) {
    return switchedOff(logger);
  }
  await publishAndHandOver(run, target, evaluation, displayNamesOf(pr, collected.commits));
  logger.info({ result: evaluation.outcome, failureCodes: evaluation.failureCodes }, 'evaluate_pr.evaluated');
  return { outcome: 'evaluated' };
}

/** Enforcement was turned off while the run was going: nothing is written, the `finalise-check` job completes the check. */
function switchedOff(logger: Logger): JobOutcome {
  logger.info({ reason: 'repository_disabled' }, 'evaluate_pr.skipped');
  return { outcome: 'skipped:repository_disabled' };
}

function superseded(logger: Logger): JobOutcome {
  logger.info('evaluate_pr.superseded');
  return { outcome: 'superseded' };
}
