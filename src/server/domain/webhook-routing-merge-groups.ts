// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { tipPullRequestOf } from './merge-group.ts';
import { mergeGroupFields } from './webhook-routing-fields.ts';
import { type Delivery, ignored, type Routing, toJob } from './webhook-routing-types.ts';

// The row of the routing table for a merge queue's group (E22-S01). GitHub waits for the required `license/cla` check on the head
// SHA of a group, so `checks_requested` becomes the job that reports on that SHA, and nothing in the request path asks GitHub
// anything. `destroyed` (the group was merged, invalidated or dequeued) is recorded and starts nothing: the intake marks the
// evaluation of the group destroyed (creating its row when no job has yet), so a job that is still waiting, or one that has not
// yet run, writes nothing for a group that is gone.

/**
 * A group's `checks_requested` is the job that evaluates it; `destroyed` is a group taken down, recorded with no job; any other
 * action is ignored. The job carries the ids, the head and base SHAs and the number the name of the group's branch gives (absent
 * when the name has not the shape of a merge queue's: the job then fails closed), never the name itself.
 */
export function routeMergeGroup({ action, payload, context }: Delivery): Routing {
  const { merge_group: group, repository, installation } = mergeGroupFields.parse(payload);
  const ids = {
    githubInstallationId: installation.id,
    githubRepoId: repository.id,
    headSha: group.head_sha,
    deliveryId: context.deliveryId,
  };
  if (action === 'destroyed') {
    return { kind: 'destroyed', group: { ...ids, baseSha: group.base_sha } };
  }
  if (action !== 'checks_requested') {
    return ignored('unsupported_action');
  }
  const tipPrNumber = tipPullRequestOf(group.head_ref);
  return toJob({
    type: 'evaluate-merge-group',
    ...ids,
    baseSha: group.base_sha,
    ...(tipPrNumber === undefined ? {} : { tipPrNumber }),
  });
}
