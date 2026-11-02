// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { pullRequestFields } from './webhook-routing-fields.ts';
import { type Delivery, ignored, type Routing, toJob } from './webhook-routing-types.ts';

/** The actions after which a pull request is evaluated again. */
const EVALUATED_ACTIONS: ReadonlySet<string> = new Set([
  'opened',
  'reopened',
  'synchronize',
  'edited',
  'ready_for_review',
]);

/** Whether `action` is one of `actions`; an event with no action is none of them. */
function isOneOf(actions: ReadonlySet<string>, action: string | undefined): boolean {
  return action !== undefined && actions.has(action);
}

/**
 * A pull request is evaluated when it is opened, reopened, pushed to, edited or taken out of draft, and its pending work
 * is pruned when it is closed, merged or not. A draft is evaluated like any other pull request, and `edited` is routed in
 * full: the cost of the many edits is bounded by the coalescing of the queue (E07).
 */
export function routePullRequest({ action, payload, context }: Delivery): Routing {
  const { pull_request: pullRequest, repository, installation } = pullRequestFields.parse(payload);
  const ids = {
    githubInstallationId: installation.id,
    githubRepoId: repository.id,
    prNumber: pullRequest.number,
    deliveryId: context.deliveryId,
  };
  if (isOneOf(EVALUATED_ACTIONS, action)) {
    return toJob({ type: 'evaluate-pr', trigger: 'pull_request', ...ids });
  }
  return action === 'closed' ? toJob({ type: 'close-pr', ...ids }) : ignored('unsupported_action');
}
