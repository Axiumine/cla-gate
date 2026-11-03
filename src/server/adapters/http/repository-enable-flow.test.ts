// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import { evaluatePr } from '../../services/evaluate-pr/evaluate-pr.ts';
import { account, commit, commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { fakeEnqueuer, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../services/org-membership-cache.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import { createCheckRunReporter } from '../../services/reporting/create-check-run-reporter.ts';
import { sweepPolicyChange } from '../../services/sweep/policy-sweep.ts';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs } from '../../test-support.ts';
import type { Database } from '../db/schema.ts';
import { httpWorld } from '../github/http-world/test-support.ts';
import { createLogger } from './logger.ts';
import { enableAs, enabledAnswerOf, enableWorld } from './repository-enable-fixture/test-support.ts';

// Turning a repository on, from the click to the Check Runs (E14-S03), with GitHub stubbed by MSW behind the real Octokit adapter: a
// repository with two open pull requests is enabled, the sweep job the call sent lists them through GitHub, an `evaluate-pr` job
// evaluates each with the real engine, and the real reporter writes the `license/cla` Check Runs. The pull request of a person who
// signed ends `success`, the one of a person who did not ends `failure`. The jobs are run in-process, in the order the queue would.

const APP = parseGithubId(4242);
const BASE_URL = 'https://cla.example.org';
const FULL_NAME = 'org-1/repo';
/** The number of the pull request whose people signed, and of the one whose people did not. */
const COVERED = 11;
const UNCOVERED = 12;

/** The mocked GitHub with tenant 1 on it and its two open pull requests; `heads` has the head SHA of each. */
async function mockedGitHub(world: Awaited<ReturnType<typeof enableWorld>>) {
  const { t1, people } = world;
  const github = await httpWorld(testGitHubKey());
  github.addInstallation(
    {
      id: t1.githubInstallationId,
      account: { id: parseGithubId(7000), login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: t1.plain.githubRepoId, fullName: FULL_NAME }],
  );
  const heads = new Map<number, string>();
  const open = (prNumber: number, person: number, first: number) => {
    const by = account(person);
    const headSha = commitSha(first + 1);
    heads.set(prNumber, headSha);
    github.addPullRequest(t1.githubInstallationId, FULL_NAME, pullRequest(prNumber, { opener: by, headSha }));
    github.setPullRequestCommits(t1.githubInstallationId, FULL_NAME, prNumber, [
      commit(first, { author: by, committer: by }),
      commit(first + 1, { author: by, committer: by }),
    ]);
  };
  open(COVERED, people.member1.githubId, 1);
  open(UNCOVERED, people.outsider.githubId, 3);
  return { github, heads };
}

/** The ports of the evaluation jobs over the mocked GitHub through the real adapter, with the real engine and the real reporter. */
function jobPorts(db: Kysely<Database>, github: GitHubClient, logger: Logger) {
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  return {
    db,
    github,
    clock,
    orgMembership: createOrgMembership({ db, github, logger, cache: createOrgMembershipCache(clock) }),
    reporter: createCheckRunReporter({ db, github, appId: APP, publicBaseUrl: BASE_URL, clock, logger }),
    evaluate: evaluatePullRequest,
  };
}

/** Tenant 1 on the mocked GitHub, the queue of the app, and what runs the jobs it holds in the order the queue would. */
async function flowWorld() {
  const queue = fakeEnqueuer();
  const world = await enableWorld(queue);
  const { github, heads } = await mockedGitHub(world);
  const logger = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const ports = jobPorts(world.db, github.client, logger);
  /** Runs the sweep job the call sent, then the evaluation jobs the sweep sent. */
  const drain = async () => {
    const [sweep] = (await sentJobs(world.db)).filter((sent) => sent.job.type === 'sweep-repository');
    if (sweep?.job.type !== 'sweep-repository') {
      throw new Error('no sweep was sent');
    }
    await sweepPolicyChange(ports, sweep.job, { logger, enqueuer: queue, jobId: 'job-1' });
    for (const sent of await sentJobs(world.db)) {
      if (sent.job.type === 'evaluate-pr') {
        await evaluatePr(ports, sent.job, { attempt: 0, logger });
      }
    }
  };
  /** The conclusion the last write to the `license/cla` run on the head of pull request `prNumber` carried. */
  const conclusionOf = async (prNumber: number) => {
    const [run] = await github.client.listCheckRunsForRef(
      world.t1.githubInstallationId,
      FULL_NAME,
      heads.get(prNumber) ?? '',
    );
    return github.checkRunWrites.findLast((record) => record.id === run?.id)?.write.conclusion;
  };
  return { ...world, github, drain, conclusionOf };
}

test('a repository with two open pull requests is enabled: after the sweep the covered one is success and the other failure', async () => {
  const world = await flowWorld();
  const { t1, github } = world;
  const response = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect([response.statusCode, enabledAnswerOf(response)]).toEqual([200, { enabled: true, changed: true }]);
  expect(github.requests).toEqual([]);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('success');
  expect(await world.conclusionOf(UNCOVERED)).toBe('failure');
  const evaluations = (await sentJobs(world.db)).flatMap((sent) =>
    sent.job.type === 'evaluate-pr' ? [[sent.job.prNumber, sent.job.trigger]] : [],
  );
  expect(evaluations.toSorted((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
    [COVERED, 'policy_change'],
    [UNCOVERED, 'policy_change'],
  ]);
});

test('the call itself makes no GitHub call: the pull requests are listed by the sweep, not by the endpoint', async () => {
  const world = await flowWorld();
  await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(world.github.requests).toEqual([]);
  expect(world.github.checkRunWrites).toEqual([]);
});
