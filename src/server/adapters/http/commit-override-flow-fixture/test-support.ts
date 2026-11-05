// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import assert from 'node:assert/strict';
import { parseStoredDetails } from '../../../../shared/pr-evaluation-details.ts';
import { account, commit } from '../../../services/github-pull-contract/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from '../repository-flow-fixture/test-support.ts';

// The world of the flow tests of the per-commit overrides (E15-S05, E15-S06): tenant 1 on the mocked GitHub behind the real Octokit adapter,
// the real engine and the real reporter, with two pull requests whose first commit has an author GitHub cannot link to an account.

export type FlowWorld = Awaited<ReturnType<typeof flowWorld>>;

/** The plain repository of tenant 1 on the mocked GitHub. */
export const FULL_NAME = 'org-1/repo';

/** The pull requests of tenant 1 as the scenario needs them: the first commit of each has an author GitHub cannot link. */
export async function unlinkedWorld(): Promise<FlowWorld> {
  const world = await flowWorld();
  const { t1, people, github } = world;
  const signer = account(people.member1.githubId);
  const stranger = account(people.outsider.githubId);
  github.setPullRequestCommits(t1.githubInstallationId, FULL_NAME, COVERED, [
    commit(1, { author: null, committer: signer }),
    commit(2, { author: signer, committer: signer }),
  ]);
  github.setPullRequestCommits(t1.githubInstallationId, FULL_NAME, UNCOVERED, [
    commit(3, { author: null, committer: stranger }),
    commit(4, { author: stranger, committer: stranger }),
  ]);
  return world;
}

/** The newest stored evaluation of a pull request: its result and the details the engine stored. */
export async function storedEvaluation(world: FlowWorld, repositoryId: number, prNumber: number) {
  const row = await world.db
    .selectFrom('pr_evaluations')
    .select(['result', 'details'])
    .where('repository_id', '=', repositoryId)
    .where('pr_number', '=', prNumber)
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  const stored = parseStoredDetails(row.details);
  assert(stored.ok, `the details of pull request ${prNumber} are not the stored shape`);
  return { result: row.result, details: stored.details };
}

/** The summary of the last write to the `license/cla` run on the head of the pull request. */
export async function summaryOf(world: FlowWorld, prNumber: number): Promise<string | undefined> {
  const [run] = await world.github.client.listCheckRunsForRef(
    world.t1.githubInstallationId,
    FULL_NAME,
    String(world.heads.get(prNumber)),
  );
  return world.github.checkRunWrites.findLast((record) => record.id === run?.id)?.write.summary;
}
