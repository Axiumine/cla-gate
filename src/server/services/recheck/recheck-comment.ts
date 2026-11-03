// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { isRecheckCommand } from '../../domain/recheck.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import type { GitHubIssueComment } from '../ports/github.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { enqueueReruns, rerunOf } from './recheck-enqueue.ts';
import type { RecheckContext, RecheckPorts } from './recheck-ports.ts';

// The `recheck-comment` job (E07-S07): somebody commented on a pull request and the comment may be the command that asks for
// a new evaluation. The webhook router only checked, loosely, that the text mentions the command; the job names the comment by
// its id and decides on the comment as GitHub has it now: the payload is a key and nothing more, so a comment that was edited
// or deleted since, or a pull request closed since, is judged by what is true when the job runs.

type Job = EnvelopeOf<'recheck-comment'>;

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'recheck.skipped');
  return { outcome: `skipped:${reason}` };
};

/** Why the comment GitHub returned is not the command, or undefined when it is. */
function commentRefusal(comment: GitHubIssueComment | null, job: Job): string | undefined {
  if (comment === null) {
    return 'comment_not_found';
  }
  if (comment.author === null) {
    return 'author_unknown';
  }
  if (comment.author.type === 'Bot') {
    return 'bot_author';
  }
  if (comment.issueNumber !== job.prNumber) {
    return 'comment_elsewhere';
  }
  return isRecheckCommand(comment.body) ? undefined : 'not_a_command';
}

/** Why the issue the comment is on is not an open pull request, or undefined when it is one. */
async function pullRequestRefusal(ports: RecheckPorts, job: Job, fullName: string): Promise<string | undefined> {
  const pr = await ports.github.getPullRequest(job.githubInstallationId, fullName, job.prNumber);
  if (pr === null) {
    return 'not_pull_request';
  }
  return pr.state === 'open' ? undefined : 'pull_request_closed';
}

async function run(ports: RecheckPorts, job: Job, context: RecheckContext): Promise<JobOutcome> {
  const { logger, enqueuer } = context;
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  const { fullName } = resolved;
  const comment = await ports.github.getIssueComment(job.githubInstallationId, fullName, job.commentId);
  const reason = commentRefusal(comment, job) ?? (await pullRequestRefusal(ports, job, fullName));
  if (reason !== undefined) {
    return skipped(logger, reason);
  }
  const rerun = rerunOf(job, job.prNumber, 'recheck', `recheck-comment:${job.commentId}`);
  return { outcome: await enqueueReruns(ports, enqueuer, logger, [rerun]) };
}

/**
 * Asks for a new evaluation of the pull request when the comment is the command (see {@link isRecheckCommand}).
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's and for an installation or
 *   repository that is not evaluated; with `repository_gone` when GitHub no longer shows the repository, and with
 *   `installation_unavailable` when it no longer serves the installation.
 * - Ends `skipped:<reason>` after the comment is fetched when GitHub no longer has it (`comment_not_found`), when it has no
 *   author or a bot wrote it (`author_unknown`, `bot_author`), when it is on another issue than the payload names
 *   (`comment_elsewhere`), when no line of it is the command (`not_a_command`), or when the issue is not a pull request
 *   (`not_pull_request`) or not an open one (`pull_request_closed`).
 * - Otherwise sends one `evaluate-pr` job with the trigger `recheck`, at most once a minute per pull request: `enqueued`, or
 *   `rate_limited` when the window dropped it (logged `recheck.rate_limited`, no reply).
 * - Throws what GitHub, the queue or the database throws: the job fails and the queue retries it.
 */
export async function recheckComment(ports: RecheckPorts, job: Job, context: RecheckContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
