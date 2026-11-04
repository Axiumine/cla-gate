// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../../shared/github-id.ts';
import { testGitHubKey } from '../../../config/test-support.ts';
import { evaluatePullRequest } from '../../../domain/evaluation/index.ts';
import type { EnvelopeOf } from '../../../domain/job-envelope.ts';
import { evaluatePr } from '../../../services/evaluate-pr/evaluate-pr.ts';
import type { EvaluatePrPorts } from '../../../services/evaluate-pr/evaluate-pr-ports.ts';
import { installation, repository } from '../../../services/github-contract/test-support.ts';
import { account, commit, commitSha, pullRequest } from '../../../services/github-pull-contract/test-support.ts';
import { type SentJob, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import { createOrgMembership } from '../../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../../services/org-membership-cache.ts';
import { createCheckRunReporter } from '../../../services/reporting/create-check-run-reporter.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { captureLogs } from '../../../test-support.ts';
import type { Database } from '../../db/schema.ts';
import { type HttpWorld, httpWorld } from '../../github/http-world/test-support.ts';
import { createLogger } from '../logger.ts';
import { signingWorld } from '../sign-fixture/test-support.ts';

// The world of the test that follows a signature through the evaluation job to the Check Run (E13-S07): the sign request on the
// real application, the `evaluate-pr` job of E07 with the engine of E08 and the reporter of E09, and a GitHub that is the mocked
// HTTP one (MSW) with the installation, the repository and the pull requests of tenant 1 (`org-1/repo`, GitHub id 9000, installation
// 5000). Ada, GitHub id 1234, opens every pull request but the ones a test gives to someone else.

const INSTALLATION = parseGithubId(5000);
const REPOSITORY = parseGithubId(9000);
const FULL_NAME = 'org-1/repo';
const APP = parseGithubId(4242);
const START = '2026-11-02T10:00:00Z';
const signer = testGitHubKey();

/** The job that evaluates a pull request of the repository: what a webhook sends, or (trigger `signature`) what a signing sends. */
export function evaluateJob(
  prNumber: number,
  trigger: EnvelopeOf<'evaluate-pr'>['trigger'] = 'pull_request',
): EnvelopeOf<'evaluate-pr'> {
  return { type: 'evaluate-pr', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, prNumber, trigger };
}

/** The `evaluate-pr` jobs among the sent ones, in the order sent. */
function evaluationJobs(sent: readonly SentJob[]): EnvelopeOf<'evaluate-pr'>[] {
  return sent.map(({ job }) => job).filter((job): job is EnvelopeOf<'evaluate-pr'> => job.type === 'evaluate-pr');
}

/** The ports of the evaluation job on database `db` and the mocked GitHub: the real engine, org lookup and Check Run reporter. */
function evaluationPorts(db: Kysely<Database>, github: HttpWorld) {
  const clock = new FakeClock(START);
  const logger = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const ports: EvaluatePrPorts = {
    db,
    github: github.client,
    clock,
    orgMembership: createOrgMembership({ db, github: github.client, logger, cache: createOrgMembershipCache(clock) }),
    reporter: createCheckRunReporter({
      db,
      github: github.client,
      appId: APP,
      publicBaseUrl: 'https://cla.example.org',
      clock,
      logger,
    }),
    evaluate: evaluatePullRequest,
  };
  return { ports, logger };
}

/** Shows pull request `prNumber` on the mocked GitHub with one commit, number `head` of the history, by Ada, open or `closed`. */
function showPullRequest(
  github: HttpWorld,
  spec: { readonly prNumber: number; readonly head: number; readonly state: 'open' | 'closed' },
): void {
  const who = account(1234);
  github.addPullRequest(
    INSTALLATION,
    FULL_NAME,
    pullRequest(spec.prNumber, {
      opener: who,
      headSha: commitSha(spec.head),
      baseSha: commitSha(spec.head - 1),
      commitCount: 1,
      state: spec.state,
    }),
  );
  github.setPullRequestCommits(INSTALLATION, FULL_NAME, spec.prNumber, [
    commit(spec.head, { author: who, committer: who }),
  ]);
}

/** The world: the sign request world with a queue, the mocked GitHub, and the job that evaluates a pull request. */
export async function reevaluationWorld() {
  const signing = await signingWorld();
  const { world } = signing;
  await world.db.updateTable('repositories').set({ enabled: true }).where('id', '=', world.t1.repositoryId).execute();
  const github = await httpWorld(signer);
  github.addInstallation(installation(INSTALLATION, 'org-1'), [repository(REPOSITORY, FULL_NAME)]);
  const { ports, logger } = evaluationPorts(world.db, github);
  return {
    ...signing,
    github,
    /** Shows pull request `prNumber` by Ada with one commit, number `head` of the history, open or `closed`. */
    open: (prNumber: number, head: number, state: 'open' | 'closed' = 'open') => {
      showPullRequest(github, { prNumber, head, state });
    },
    /** Runs the evaluation job for the envelope, as a first attempt. */
    run: (job: EnvelopeOf<'evaluate-pr'>) => evaluatePr(ports, job, { attempt: 0, logger }),
    /** The jobs of the sign requests so far, in the order sent. */
    queued: async () => evaluationJobs(await sentJobs(world.db)),
    /** Every write the mocked GitHub accepted for a Check Run, oldest first: `<create or update> <run id> <status> <conclusion>`. */
    checkRunWrites: () =>
      github.checkRuns.writes.map(
        ({ kind, id, write }) => `${kind} ${id} ${write.status} ${write.conclusion ?? 'none'}`,
      ),
  };
}
