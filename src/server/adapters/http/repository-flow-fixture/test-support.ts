// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Logger } from 'pino';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import { testGitHubKey } from '../../../config/test-support.ts';
import { evaluatePullRequest } from '../../../domain/evaluation/index.ts';
import { evaluatePr } from '../../../services/evaluate-pr/evaluate-pr.ts';
import type { EvaluatePrPorts } from '../../../services/evaluate-pr/evaluate-pr-ports.ts';
import {
  defaultCommits,
  evaluateWorld,
  INSTALLATION,
  ORG,
  PR_NUMBER,
  REPOSITORY,
} from '../../../services/evaluate-pr/test-support.ts';
import { finaliseCheck } from '../../../services/finalise/finalise-check.ts';
import { finaliseRepository } from '../../../services/finalise/finalise-repository.ts';
import { account, commit, commitSha, pullRequest } from '../../../services/github-pull-contract/test-support.ts';
import {
  createJobsTable,
  type FakeEnqueuer,
  fakeEnqueuer,
  type SentJob,
  sentJobs,
} from '../../../services/jobs-fixture/test-support.ts';
import { createOrgMembership } from '../../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../../services/org-membership-cache.ts';
import type { GitHubClient } from '../../../services/ports/github.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { EvaluationReporter } from '../../../services/ports/reporter.ts';
import { createCheckRunReporter } from '../../../services/reporting/create-check-run-reporter.ts';
import { sweepPolicyChange } from '../../../services/sweep/policy-sweep.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { captureLogs } from '../../../test-support.ts';
import type { Database } from '../../db/schema.ts';
import { type HttpWorld, httpWorld } from '../../github/http-world/test-support.ts';
import { createLogger } from '../logger.ts';
import { enableWorld } from '../repository-enable-fixture/test-support.ts';

// The flow of a repository's enforcement from the click to the Check Runs (E14-S03, E14-S04), with GitHub stubbed by MSW behind the
// real Octokit adapter: tenant 1's repository has two open pull requests, the jobs the app sends are run in-process in the order the
// queue would, with the real engine and the real reporter, and what GitHub was sent is read from the mocked GitHub.

const APP = parseGithubId(4242);
const BASE_URL = 'https://cla.example.org';
const FULL_NAME = 'org-1/repo';
/** The number of the pull request whose people signed, and of the one whose people did not. */
export const COVERED = 11;
export const UNCOVERED = 12;

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
export function jobPorts(db: Kysely<Database>, github: GitHubClient, logger: Logger): EvaluatePrPorts {
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

/** Runs one job the app sent, as the queue would: the job id is the idempotency key of its send, which is unique. */
async function runSent(
  sent: SentJob,
  ports: EvaluatePrPorts,
  context: { logger: Logger; enqueuer: FakeEnqueuer },
): Promise<void> {
  const { job, idempotencyKey: jobId } = sent;
  const run = { ...context, jobId };
  if (job.type === 'sweep-repository') {
    await sweepPolicyChange(ports, job, run);
  } else if (job.type === 'evaluate-pr') {
    await evaluatePr(ports, job, { ...run, attempt: 0 });
  } else if (job.type === 'finalise-repository') {
    await finaliseRepository(ports, job, run);
  } else if (job.type === 'finalise-check') {
    await finaliseCheck(ports, job, run);
  } else {
    throw new Error(`the flow does not run ${job.type}`);
  }
}

/** What runs the jobs of a flow: the database they work on, the mocked GitHub, the head SHA of each pull request and the queue. */
interface Flow {
  readonly db: Kysely<Database>;
  readonly github: HttpWorld;
  readonly heads: ReadonlyMap<number, string>;
  readonly queue: FakeEnqueuer;
  readonly installation: GithubId;
  readonly fullName: string;
}

/** The ports of the jobs of `flow`, what drains its queue in the order the queue would, and what reads the conclusion of a run. */
function driverOf(flow: Flow) {
  const { db, github, heads, queue } = flow;
  const logger = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const ports = jobPorts(db, github.client, logger);
  const ran = new Set<string>();
  const unrun = async () => (await sentJobs(db)).filter((sent) => !ran.has(sent.idempotencyKey));
  /** Runs every job the app sent that has not run yet, and the jobs those send in turn, until none is left. */
  const drain = async () => {
    for (let pending = await unrun(); pending.length > 0; pending = await unrun()) {
      for (const sent of pending) {
        ran.add(sent.idempotencyKey);
        await runSent(sent, ports, { logger, enqueuer: queue });
        // The job is over: a send under the coalesce key of its pull request is a new job, as on the real queue.
        await sql`update fake_jobs set state = 'completed' where idempotency_key = ${sent.idempotencyKey}`.execute(db);
      }
    }
  };
  /** The conclusion the last write to the `license/cla` run on the head of pull request `prNumber` carried. */
  const conclusionOf = async (prNumber: number) => {
    const [run] = await github.client.listCheckRunsForRef(
      flow.installation,
      flow.fullName,
      String(heads.get(prNumber)),
    );
    return github.checkRunWrites.findLast((record) => record.id === run?.id)?.write.conclusion;
  };
  return { logger, ports, drain, conclusionOf };
}

/**
 * Tenant 1 on the mocked GitHub, the queue of the app, and what runs the jobs it holds in the order the queue would. `through`
 * wraps the queue the app sends to (a test that holds a send open), and the jobs of the flow are sent to the queue itself.
 */
export async function flowWorld(through: (queue: FakeEnqueuer) => JobEnqueuer = (queue) => queue) {
  const queue = fakeEnqueuer();
  const world = await enableWorld(through(queue));
  const { github, heads } = await mockedGitHub(world);
  const driver = driverOf({
    db: world.db,
    github,
    heads,
    queue,
    installation: world.t1.githubInstallationId,
    fullName: FULL_NAME,
  });
  return { ...world, github, heads, queue, ...driver };
}

/**
 * The tenant of the `evaluate-pr` tests (installation 5000, repository 9000 on, a CLA attached, nobody signed) on the database of the
 * run, whatever its engine, with its pull request 7 on the mocked GitHub: for the races that need a second connection, which the
 * app worlds (PGlite always) cannot give. The real engine judges the pull request `failure`.
 */
export async function liveWorld() {
  const world = await evaluateWorld({ engine: true });
  await createJobsTable(world.raw);
  const queue = fakeEnqueuer();
  const github = await httpWorld(testGitHubKey());
  github.addInstallation(
    {
      id: INSTALLATION,
      account: { id: ORG, login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: REPOSITORY, fullName: FULL_NAME }],
  );
  github.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { opener: account(7) }));
  github.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, defaultCommits());
  const heads = new Map([[PR_NUMBER, pullRequest(PR_NUMBER).headSha]]);
  const driver = driverOf({
    db: world.raw,
    github,
    heads,
    queue,
    installation: INSTALLATION,
    fullName: FULL_NAME,
  });
  return { ...world, github, queue, ...driver };
}

/** Where in the evaluation a test switches the repository off: after the run was opened, just before the verdict is written, just after. */
export type Cut = 'after-started' | 'before-publish' | 'after-publish';

/** A reporter that runs the action of each cut once, when the evaluation reaches it, and otherwise does what `inner` does. */
export function interleaved(
  inner: EvaluationReporter,
  actions: Partial<Record<Cut, () => Promise<void>>>,
): EvaluationReporter {
  const pending = new Map<string, () => Promise<void>>(Object.entries(actions));
  const at = async (here: Cut): Promise<void> => {
    const action = pending.get(here);
    pending.delete(here);
    await action?.();
  };
  return {
    started: async (target) => {
      const outcome = await inner.started(target);
      await at('after-started');
      return outcome;
    },
    publish: async (target, evaluation, names) => {
      await at('before-publish');
      const outcome = await inner.publish(target, evaluation, names);
      await at('after-publish');
      return outcome;
    },
    failed: (target, code) => inner.failed(target, code),
    cancelled: (target) => inner.cancelled(target),
    enforcementDisabled: (target) => inner.enforcementDisabled(target),
  };
}
