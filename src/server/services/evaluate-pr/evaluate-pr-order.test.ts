// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedSignature } from '../../adapters/db/test-support.ts';
import { toStoredDetails } from '../../domain/evaluation/index.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { type EvaluateWorld, evaluateWorld, INSTALLATION, ORG, passing } from './test-support.ts';

// The order of the protocol and what each step hands to the next (E07-S04). Opener 7 and the authors 1 and 2 are people; 1
// signed, the installation allowlists the members of its organisation, and 2 is one of them.

/** The world of this file: the allowlist of the organisation's members, a signature of user 1, and user 2 as a member. */
async function organisationWorld(): Promise<EvaluateWorld> {
  const world = await evaluateWorld();
  await world.raw
    .insertInto('allowlist_entries')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: null,
      kind: 'org_members',
      github_id: ORG,
      created_by: world.tenant.publisherId,
    })
    .execute();
  await seedSignature(world.raw, world.tenant, 1);
  world.fake.addMembership(INSTALLATION, 'org-1', 'user-2', {
    state: 'active',
    role: 'member',
    userId: parseGithubId(2),
  });
  return world;
}

test('the steps run in the order of the protocol: repository, pull request, row and started, commits, policy, members, signatures last, engine, pull request again, write, publish', async () => {
  const world = await organisationWorld();
  await world.run();
  const steps = world.timeline.filter((step) => !['db:select installations', 'db:select repositories'].includes(step));
  expect(steps).toEqual([
    'gh:getRepositoryById',
    'gh:getPullRequest',
    'db:select pr_evaluations',
    'db:insert pr_evaluations',
    'reporter.started',
    'gh:listPullRequestCommits',
    'db:select cla_documents',
    'db:select allowlist_entries',
    'db:select commit_overrides',
    'db:select signatures',
    'gh:getOrgMembership',
    'gh:getOrgMembership',
    'db:select signatures',
    'evaluate',
    'gh:getPullRequest',
    'db:update pr_evaluations',
    'reporter.publish',
  ]);
});

test('the signatures are the last facts read: nothing but the engine, the second look at the pull request, the stored verdict, the re-check that enforcement is still on and the write follow them, and the re-check is made once more after the write (E14-S04)', async () => {
  const world = await organisationWorld();
  await world.run();
  const lastSignatures = world.timeline.lastIndexOf('db:select signatures');
  expect(world.timeline.slice(lastSignatures + 1)).toEqual([
    'evaluate',
    'gh:getPullRequest',
    'db:update pr_evaluations',
    'db:select repositories',
    'reporter.publish',
    'db:select repositories',
  ]);
});

test('the evaluation is in progress, with empty details, when the report that it began is made, and stored before the verdict is published', async () => {
  const world = await evaluateWorld();
  const seen: unknown[] = [];
  world.reporter.hooks.started = async () => {
    seen.push((await world.rows()).map((row) => [row.result, row.details]));
  };
  world.reporter.hooks.publish = async () => {
    seen.push((await world.rows()).map((row) => row.result));
  };
  world.evaluate.mockImplementation(() => passing());
  await world.run();
  expect(seen).toEqual([[['in_progress', {}]], ['success']]);
});

test('the verdict is stored as toStoredDetails of the evaluation and the reporter is given the evaluation of the engine and the target of the head SHA that was evaluated', async () => {
  const world = await evaluateWorld();
  const verdict = passing({ documentId: world.tenant.documentId, activeMajor: 1 });
  world.evaluate.mockReturnValue(verdict);
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  const [row] = await world.rows();
  expect(row).toMatchObject({
    pr_number: 7,
    head_sha: commitSha(2),
    result: 'success',
    details: toStoredDetails(verdict),
  });
  expect(world.reporter.published).toEqual([
    {
      target: {
        githubInstallationId: INSTALLATION,
        githubRepoId: 9000,
        fullName: 'org-1/repo',
        prNumber: 7,
        headSha: commitSha(2),
        trigger: 'pull_request',
        evaluationId: row?.id,
      },
      evaluation: verdict,
      names: {
        logins: new Map([
          [7, 'user-7'],
          [1, 'user-1'],
          [2, 'user-2'],
        ]),
        coAuthors: new Map<string, readonly string[]>(),
      },
    },
  ]);
  expect(world.reporter.startedTargets).toEqual([world.reporter.published[0]?.target]);
});

test('a failing verdict is stored as failure', async () => {
  const world = await evaluateWorld();
  world.evaluate.mockReturnValue({
    ...passing(),
    outcome: 'failure',
    failureCodes: ['commit_limit_exceeded'],
    listing: 'exceeded',
  });
  await world.run();
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('the engine is given the facts of the tenant: the opener and the commits as ids and types, the policy, the allowlist, the members and only the signatures of the actors', async () => {
  const world = await organisationWorld();
  await seedSignature(world.raw, world.tenant, 555);
  await world.run();
  const [input] = world.evaluate.mock.calls[0] ?? [];
  expect(input).toMatchObject({
    headSha: commitSha(2),
    opener: { id: 7, type: 'User' },
    listing: 'complete',
    policy: { documentId: world.tenant.documentId, activeMajor: 1 },
    allowlist: [{ kind: 'org_members', githubId: 7000, scope: 'installation' }],
    overrides: new Map<string, number>(),
  });
  expect(input?.commits.map((commit) => [commit.sha, commit.author, commit.committer])).toEqual([
    [commitSha(1), { id: 1, type: 'User' }, { id: 1, type: 'User' }],
    [commitSha(2), { id: 2, type: 'User' }, { id: 2, type: 'User' }],
  ]);
  expect(input?.signatures.map((fact) => [fact.githubId, fact.major, fact.revoked])).toEqual([[1, 1, false]]);
  expect(input?.orgMembers).toEqual(new Map([[7000, new Set([2])]]));
  expect(JSON.stringify(input)).not.toContain('"login"');
});

test('a revoked signature is not a fact, and a signature on another document is not either', async () => {
  const world = await evaluateWorld();
  const { signatureId } = await seedSignature(world.raw, world.tenant, 1);
  await seedSignature(world.raw, world.tenant, 2);
  await world.raw
    .updateTable('signatures')
    .set({ revoked_at: new Date(), revoked_by: world.tenant.publisherId, revoke_reason: 'other' })
    .where('id', '=', signatureId)
    .execute();
  await world.run();
  const [input] = world.evaluate.mock.calls[0] ?? [];
  expect(input?.signatures.map((fact) => fact.githubId)).toEqual([2]);
});
