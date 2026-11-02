// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { issueCommentFields } from './webhook-routing-fields.ts';
import { type Delivery, ignored, type Routing, toJob } from './webhook-routing-types.ts';

/** The comment text that asks for a new evaluation. A loose prefilter: the exact-line rule belongs to the job (E07-S07). */
const RECHECK_COMMAND = '/recheck';

/**
 * A deliberately loose prefilter, so that a pull request comment does not cost a job: the comment is new, it is on a
 * pull request, its sender is not a Bot and its text contains `/recheck` anywhere. The job re-fetches the comment and
 * applies the exact-line rule and the rate limit to what GitHub returns (E07-S07); the text of the comment is not copied
 * into the job, which names the comment by its id.
 */
export function routeIssueComment({ action, payload, context }: Delivery): Routing {
  const { issue, comment, sender, repository, installation } = issueCommentFields.parse(payload);
  if (action !== 'created') {
    return ignored('unsupported_action');
  }
  if (issue.pull_request === undefined) {
    return ignored('not_pull_request');
  }
  if (sender.type === 'Bot') {
    return ignored('bot_sender');
  }
  return comment.body.includes(RECHECK_COMMAND)
    ? toJob({
        type: 'recheck-comment',
        githubInstallationId: installation.id,
        githubRepoId: repository.id,
        prNumber: issue.number,
        commentId: comment.id,
        deliveryId: context.deliveryId,
      })
    : ignored('no_recheck_command');
}
