// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Logger } from 'pino';
import { parseGithubId } from '../../../shared/github-id.ts';
import { insertEvaluation, readAllEvaluations } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { migratedTestDatabase, seedTenant, type Tenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { type Evaluation, evaluatePullRequest } from '../../domain/evaluation/index.ts';
import { commitFacts, evaluationInput, signatureFact } from '../../domain/evaluation/test-support.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { comment, type pullRef } from '../github-comment-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import type { GitHubClient, GitHubIssueComment } from '../ports/github.ts';
import type { ReportTarget, RunTarget } from '../ports/reporter.ts';
import { FakeClock, FakeGitHub } from '../test-support.ts';
import { CheckRunReporter } from './check-run-reporter.ts';
import { CheckRunWriter } from './check-run-writer.ts';

// The world of the tests of the Check Run reporter (E09-S05): a migrated database with the tenant `org-1` (installation 5000,
// repository 9000 `org-1/repo`), a FakeGitHub that serves it, the reporter on both, and the verdicts of the real engine
// to publish. Pull request 7 is the one the tests are about; its head SHA is `HEAD`.

export const INSTALLATION = parseGithubId(5000);
export const REPOSITORY = parseGithubId(9000);
export const FULL_NAME = 'org-1/repo';
export const BASE_URL = 'https://cla.example.org';
/** The head SHA of the pull requests of the tests. */
export const HEAD = commitSha(2);
/** The App the FakeGitHub stands for: the id its runs carry. */
export const APP = parseGithubId(4242);
export const START = '2026-11-02T10:00:00Z';

/** The first line of every comment of the platform. */
export const MARKER = '<!-- cla-platform:license/cla:v1 -->';

/** A comment on pull request 7 that the App wrote: the marker first, posted through the App, by a bot. Override a field to forge it. */
export function ours(commentId: number, overrides: Partial<GitHubIssueComment> = {}): GitHubIssueComment {
  return comment(commentId, {
    body: `${MARKER}\nold text`,
    appId: APP,
    author: { id: parseGithubId(9), type: 'Bot' },
    ...overrides,
  });
}

/** The methods of the port a test looked at, in order, that are about the comment of the pull request. */
export function commentCalls(fake: FakeGitHub): string[] {
  return fake.calls.map((call) => call.method).filter((method) => method.includes('IssueComment'));
}

/** The login the job saw for user 1. */
export const NAMES: DisplayNames = { logins: new Map([[1, 'octocat']]), coAuthors: new Map() };

/** The verdict on a pull request whose one contributor (user 1) signed. */
export const PASSING: Evaluation = evaluatePullRequest(
  evaluationInput({ commits: [commitFacts(1)], signatures: [signatureFact(1, 1)] }),
);

/** The verdict on a pull request whose one contributor (user 1) did not sign. */
export const FAILING: Evaluation = evaluatePullRequest(evaluationInput({ commits: [commitFacts(1)] }));

export interface ReportingWorld {
  readonly db: Kysely<Database>;
  readonly tenant: Tenant;
  readonly fake: FakeGitHub;
  readonly reporter: CheckRunReporter;
  readonly writer: CheckRunWriter;
  readonly clock: FakeClock;
  readonly logs: LogCapture;
  /** The logger that writes into `logs`. */
  readonly logger: Logger;
  /** Stores the row of a pull request at a head SHA and returns the target of a report on it. */
  readonly evaluation: (spec?: EvaluationSpec) => Promise<ReportTarget>;
  /** The rows of `pr_evaluations`, oldest first. */
  readonly rows: () => ReturnType<typeof readAllEvaluations>;
  /** Gives every row of pull request `prNumber` the result the job stores when it finishes, and the details it stores with it. */
  readonly settle: (
    prNumber: number,
    result: Database['pr_evaluations']['result'],
    details?: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
}

/** What a test chooses of a pull request: the rest is pull request 7 at `HEAD`, evaluated on a `pull_request` event. */
interface EvaluationSpec {
  readonly prNumber?: number;
  readonly headSha?: string;
  readonly result?: Database['pr_evaluations']['result'];
  readonly checkRunId?: number;
  /** The id of the pull request comment the row records. */
  readonly commentId?: number;
  /** When the row was last touched; the database's `now()` when absent. */
  readonly updatedAt?: Date;
  readonly trigger?: ReportTarget['trigger'];
}

/** A FakeGitHub that serves the tenant `org-1`: its installation and the one repository. */
function tenantGithub(): FakeGitHub {
  const fake = new FakeGitHub();
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: parseGithubId(7000), login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: REPOSITORY, fullName: FULL_NAME }],
  );
  return fake;
}

/** Stores the row of a pull request of the tenant and returns the target of a report on it. */
async function storeEvaluation(db: Kysely<Database>, tenant: Tenant, spec: EvaluationSpec): Promise<ReportTarget> {
  const prNumber = spec.prNumber ?? 7;
  const headSha = spec.headSha ?? HEAD;
  const evaluationId = await insertEvaluation(db, tenant, {
    prNumber,
    headSha,
    result: spec.result ?? 'in_progress',
    ...(spec.checkRunId === undefined ? {} : { checkRunId: spec.checkRunId }),
    ...(spec.commentId === undefined ? {} : { commentId: spec.commentId }),
    ...(spec.updatedAt === undefined ? {} : { updatedAt: spec.updatedAt }),
  });
  return {
    githubInstallationId: INSTALLATION,
    githubRepoId: REPOSITORY,
    fullName: FULL_NAME,
    prNumber,
    headSha,
    trigger: spec.trigger ?? 'pull_request',
    evaluationId,
  };
}

/**
 * The world of a reporter. `db` is the handle the reporter reads and writes through (a recording one, say) and `github` the client
 * it reports to: the FakeGitHub of the world by default, or the Octokit adapter behind MSW.
 */
export async function reportingWorld(
  options: { readonly db?: Kysely<Database>; readonly github?: GitHubClient } = {},
): Promise<ReportingWorld> {
  const { db: raw } = await migratedTestDatabase();
  const tenant = await seedTenant(raw, 1);
  const fake = tenantGithub();
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const clock = new FakeClock(START);
  const github = options.github ?? fake;
  const writer = new CheckRunWriter({ github, appId: APP, clock, logger });
  const db = options.db ?? raw;
  const reporter = new CheckRunReporter({ db, github, writer, appId: APP, publicBaseUrl: BASE_URL, logger });
  return {
    db,
    tenant,
    fake,
    reporter,
    writer,
    clock,
    logs,
    logger,
    evaluation: (spec = {}) => storeEvaluation(raw, tenant, spec),
    rows: () => readAllEvaluations(raw),
    settle: async (prNumber, result, details = {}) => {
      await sql`update pr_evaluations set result = ${result}, details = ${JSON.stringify(details)}::jsonb where pr_number = ${prNumber}`.execute(
        raw,
      );
    },
  };
}

/** The head SHA a pull request moved on to: not `HEAD`. */
export const MOVED = commitSha(5);

/** What GitHub lists for the commit `HEAD` (`GET .../commits/{sha}/pulls`): the pull requests, as `pullRef` makes them. */
export function listed(world: ReportingWorld, ...pulls: ReturnType<typeof pullRef>[]): void {
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, pulls);
}

/**
 * Starts `targets` at the same moment: each lists the runs of the SHA before any of them creates one, so each creates its own
 * (two pull requests at one SHA, or the same pull request twice, E09-S05).
 */
export async function startTogether(world: ReportingWorld, targets: readonly ReportTarget[]): Promise<void> {
  const arrived = Promise.withResolvers<undefined>();
  let listings = 0;
  const meet = (): Promise<undefined> => {
    listings += 1;
    if (listings === targets.length) {
      arrived.resolve(undefined);
    }
    return arrived.promise;
  };
  targets.forEach(() => {
    world.fake.beforeNext('listCheckRunsForRef', meet);
  });
  await Promise.all(targets.map((target) => world.reporter.started(target)));
}

/** The target of a report that has no trigger (a cancellation, a repository switched off): `target` without it. */
export function withoutTrigger(target: ReportTarget): RunTarget {
  return {
    githubInstallationId: target.githubInstallationId,
    githubRepoId: target.githubRepoId,
    fullName: target.fullName,
    prNumber: target.prNumber,
    headSha: target.headSha,
    evaluationId: target.evaluationId,
  };
}
