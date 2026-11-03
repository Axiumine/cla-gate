// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type KyselyPlugin, type PluginTransformQueryArgs, sql } from 'kysely';
import { type Mock, vi } from 'vitest';
import { z } from 'zod';
import { parseGithubId } from '../../../shared/github-id.ts';
import { loadMigrationFiles } from '../../adapters/db/migration-files.ts';
import { migrate } from '../../adapters/db/migrator.ts';
import { openPgliteDatabase } from '../../adapters/db/pglite.ts';
import type { Database } from '../../adapters/db/schema.ts';
import {
  MIGRATIONS_DIRECTORY,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  seedTenant,
  type Tenant,
} from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { type Evaluation, type EvaluationInput, evaluatePullRequest } from '../../domain/evaluation/index.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { account, commit, pullRequest } from '../github-pull-contract/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import { createOrgMembership } from '../org-membership.ts';
import { createOrgMembershipCache } from '../org-membership-cache.ts';
import type { EvaluationReporter, ReportOutcome, ReportTarget } from '../ports/reporter.ts';
import { FakeClock, FakeGate, FakeGitHub } from '../test-support.ts';
import { evaluatePr } from './evaluate-pr.ts';
import type { EvaluatePrContext, EvaluatePrPorts } from './evaluate-pr-ports.ts';

/** Why a failure is reported (E07-S05): the code of `EvaluationReporter.failed`. */
type ReportFailureCode = Parameters<EvaluationReporter['failed']>[1];

/** What a cancellation is about (E07-S06): the target of `EvaluationReporter.cancelled`. */
type CancelTarget = Parameters<EvaluationReporter['cancelled']>[0];

/** What every method of a FakeReporter answers unless a test says otherwise: the report was made (E09-S06). */
const REPORTED: ReportOutcome = { status: 'reported' };

// The world of the tests of the `evaluate-pr` job (E07-S04): a migrated database with one tenant, a FakeGitHub that serves
// its installation, repository, pull request and commits, a FakeReporter, an evaluator that is a stub unless a test brings the
// real one, and a timeline in which the calls to GitHub, the statements on the database and the steps of the job fall in
// the order they happened.

export const INSTALLATION = parseGithubId(5000);
export const ORG = parseGithubId(7000);
export const REPOSITORY = parseGithubId(9000);
export const FULL_NAME = 'org-1/repo';
export const PR_NUMBER = 7;

/** The job that evaluates pull request 7 of the repository of the tenant. */
export const JOB: EnvelopeOf<'evaluate-pr'> = {
  type: 'evaluate-pr',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
  trigger: 'pull_request',
};

const TableNode = z.looseObject({
  kind: z.literal('TableNode'),
  table: z.looseObject({ identifier: z.looseObject({ name: z.string() }) }),
});
const Fields = z.record(z.string(), z.unknown());
const Items = z.array(z.unknown());

/** The first table a query node names, found by walking the node: `signatures`, `pr_evaluations`... */
function firstTable(node: unknown): string | undefined {
  const table = TableNode.safeParse(node);
  if (table.success) {
    return table.data.table.identifier.name;
  }
  const children = Items.safeParse(node).data ?? Object.values(Fields.safeParse(node).data ?? {});
  return children.map(firstTable).find((name) => name !== undefined);
}

const VERBS: Readonly<Record<string, string>> = {
  SelectQueryNode: 'select',
  InsertQueryNode: 'insert',
  UpdateQueryNode: 'update',
  DeleteQueryNode: 'delete',
};

/** A database handle that notes `db:<verb> <table>` in `timeline` for every statement sent through it. */
function timedDatabase(db: Kysely<Database>, timeline: string[]): Kysely<Database> {
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }: PluginTransformQueryArgs) => {
      timeline.push(`db:${VERBS[node.kind] ?? node.kind} ${firstTable(node) ?? '?'}`);
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return db.withPlugin(plugin);
}

/** What a FakeReporter was asked, and what it does when asked: nothing, unless a test says so. */
export interface ReporterHooks {
  started?: ((target: ReportTarget) => Promise<void>) | undefined;
  publish?: ((target: ReportTarget, evaluation: Evaluation, names: DisplayNames) => Promise<void>) | undefined;
  failed?: ((target: ReportTarget, code: ReportFailureCode) => Promise<void>) | undefined;
  cancelled?: ((target: CancelTarget) => Promise<void>) | undefined;
  enforcementDisabled?: ((target: CancelTarget) => Promise<void>) | undefined;
}

/** The reporter in memory: every report it was given, in order, and an optional behaviour for each method (E07-S04). */
export class FakeReporter implements EvaluationReporter {
  readonly startedTargets: ReportTarget[] = [];
  readonly published: {
    readonly target: ReportTarget;
    readonly evaluation: Evaluation;
    readonly names: DisplayNames;
  }[] = [];
  /** The failures reported (E07-S05), in order. */
  readonly failures: { readonly target: ReportTarget; readonly code: ReportFailureCode }[] = [];
  /** The pull requests reported as closed (E07-S06), in order. */
  readonly cancellations: CancelTarget[] = [];
  /** The pull requests whose repository was reported as switched off (E09-S06), in order. */
  readonly disabled: CancelTarget[] = [];
  readonly hooks: ReporterHooks = {};
  /** The events of every fake that was given this list, in order (E07-S05). */
  readonly timeline: string[];

  constructor(timeline: string[] = []) {
    this.timeline = timeline;
  }

  async started(target: ReportTarget): Promise<ReportOutcome> {
    this.timeline.push('reporter.started');
    this.startedTargets.push(target);
    await this.hooks.started?.(target);
    return REPORTED;
  }

  async publish(target: ReportTarget, evaluation: Evaluation, names: DisplayNames): Promise<ReportOutcome> {
    this.timeline.push('reporter.publish');
    this.published.push({ target, evaluation, names });
    await this.hooks.publish?.(target, evaluation, names);
    return REPORTED;
  }

  async failed(target: ReportTarget, code: ReportFailureCode): Promise<ReportOutcome> {
    this.timeline.push('reporter.failed');
    this.failures.push({ target, code });
    await this.hooks.failed?.(target, code);
    return REPORTED;
  }

  async cancelled(target: CancelTarget): Promise<ReportOutcome> {
    this.timeline.push('reporter.cancelled');
    this.cancellations.push(target);
    await this.hooks.cancelled?.(target);
    return REPORTED;
  }

  async enforcementDisabled(target: CancelTarget): Promise<ReportOutcome> {
    this.timeline.push('reporter.enforcement_disabled');
    this.disabled.push(target);
    await this.hooks.enforcementDisabled?.(target);
    return REPORTED;
  }
}

/** A verdict of success for the policy, as a stub engine returns it. */
export function passing(policy: Evaluation['policy'] = { documentId: 1, activeMajor: 1 }): Evaluation {
  return {
    outcome: 'success',
    failureCodes: [],
    policy,
    listing: 'complete',
    commitCount: 2,
    mergeCommitsSkipped: 0,
    actors: [],
    findings: [],
    advisories: [],
    fixes: [],
  };
}

export interface EvaluateWorld {
  /** The database as the job sees it, which notes its statements in the timeline. */
  readonly db: Kysely<Database>;
  /** The database as it is, for what a test reads or writes by hand. */
  readonly raw: Kysely<Database>;
  readonly tenant: Tenant;
  readonly fake: FakeGitHub;
  readonly gate: FakeGate;
  readonly reporter: FakeReporter;
  readonly evaluate: Mock<(input: EvaluationInput) => Evaluation>;
  readonly ports: EvaluatePrPorts;
  readonly logs: LogCapture;
  /** `gh:<method>`, `db:<verb> <table>`, `reporter.<method>` and `evaluate`, in the order they happened. */
  readonly timeline: string[];
  /** Runs the job (the one of this world unless given another) as its first attempt unless given another context. */
  readonly run: (job?: EnvelopeOf<'evaluate-pr'>, context?: Partial<EvaluatePrContext>) => Promise<JobOutcome>;
  /** The rows of `pr_evaluations`, oldest first. */
  readonly rows: () => Promise<
    { id: number; pr_number: number; head_sha: string; result: string; details: unknown; check_run_id: number | null }[]
  >;
  /** The `GitHubMethod`s FakeGitHub served, in order. */
  readonly calls: () => string[];
}

/** The commits `commit(1)` and `commit(2)` of pull request 7, whose opener is user 7. */
export function defaultCommits() {
  return [commit(1), commit(2)];
}

/** A GitHub that has the installation of the tenant, its repository and open pull request 7 with two commits. */
export function githubWorld(gate?: FakeGate): FakeGitHub {
  const fake = new FakeGitHub(gate === undefined ? {} : { gate });
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: ORG, login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: REPOSITORY, fullName: FULL_NAME }],
  );
  fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { opener: account(7) }));
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, defaultCommits());
  return fake;
}

/** What a world is built with: the CLA document, the real engine, the runtime role, or a database of its own. */
interface WorldOptions {
  cla?: boolean;
  engine?: boolean;
  runtime?: boolean;
  /** A migrated PGlite of its own instead of the shared one of the test file, for a world whose app destroys the database when it closes (E09-S08). */
  own?: boolean;
}

/** A migrated PGlite that belongs to the world that asks for it. */
async function ownDatabase(): Promise<{ db: Kysely<Database> }> {
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  return { db };
}

/** The shared database of the test file, migrated; with the runtime role in place for `runtime`. */
function sharedDatabase(runtime: boolean | undefined): Promise<{ db: Kysely<Database> }> {
  return runtime === true ? migratedRuntimeDatabase() : migratedTestDatabase();
}

/** The tenant `org-1` (installation 5000, repository 9000 `org-1/repo`), admitted, with enforcement on and its CLA document attached. */
async function seededTenant(options: WorldOptions) {
  const { db: raw } = await (options.own === true ? ownDatabase() : sharedDatabase(options.runtime));
  const tenant = await seedTenant(raw, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(raw);
  await raw
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: options.cla === false ? null : tenant.documentId })
    .where('installation_id', '=', tenant.installationId)
    .execute();
  return { raw, tenant };
}

/**
 * The tenant of {@link seededTenant} on a migrated database and the GitHub of {@link githubWorld}. The engine is a stub that
 * passes unless `engine` brings the real one; `runtime` migrates with the runtime role in place, for the tests that run the
 * job as `cla_app`.
 */
export async function evaluateWorld(options: WorldOptions = {}): Promise<EvaluateWorld> {
  const { raw, tenant } = await seededTenant(options);
  const timeline: string[] = [];
  const gate = new FakeGate();
  const fake = githubWorld(gate);
  fake.observe((call) => timeline.push(`gh:${call.method}`));
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const db = timedDatabase(raw, timeline);
  const reporter = new FakeReporter(timeline);
  const evaluate = vi.fn<(input: EvaluationInput) => Evaluation>((input) => {
    timeline.push('evaluate');
    return options.engine === true
      ? evaluatePullRequest(input)
      : passing({ documentId: tenant.documentId, activeMajor: 1 });
  });
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const ports: EvaluatePrPorts = {
    db,
    github: fake,
    clock,
    orgMembership: createOrgMembership({ db, github: fake, logger, cache: createOrgMembershipCache(clock) }),
    reporter,
    evaluate,
  };
  return {
    db,
    raw,
    tenant: { ...tenant },
    fake,
    gate,
    reporter,
    evaluate,
    ports,
    logs,
    timeline,
    run: (job = JOB, context = {}) => evaluatePr(ports, job, { attempt: 0, logger, ...context }),
    rows: async () =>
      raw
        .selectFrom('pr_evaluations')
        .select(['id', 'pr_number', 'head_sha', 'result', 'details', 'check_run_id'])
        .orderBy('id')
        .execute(),
    calls: () => fake.calls.map((call) => call.method),
  };
}

/** The input the engine was last given: what the facts of the job came to. */
export function engineInput(world: EvaluateWorld): EvaluationInput {
  const input = world.evaluate.mock.calls.at(-1)?.[0];
  if (input === undefined) {
    throw new Error('the engine was not run');
  }
  return input;
}

/** An entry of the allowlist of the tenant: for the installation, or for one of its repositories (`repositoryId`, a row id). */
export async function allow(
  world: EvaluateWorld,
  entry: { readonly kind: 'user' | 'bot' | 'org_members'; readonly githubId: number; readonly repositoryId?: number },
): Promise<void> {
  await world.raw
    .insertInto('allowlist_entries')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: entry.repositoryId ?? null,
      kind: entry.kind,
      github_id: entry.githubId,
      created_by: world.tenant.publisherId,
    })
    .execute();
}

/** Makes user `n` (login `user-<n>`) an active member of the installing organisation, for GitHub. */
export function enrol(world: EvaluateWorld, n: number): void {
  world.fake.addMembership(INSTALLATION, 'org-1', `user-${n}`, {
    state: 'active',
    role: 'member',
    userId: parseGithubId(n),
  });
}

/** How many membership lookups GitHub served. */
export const lookups = (world: EvaluateWorld): number =>
  world.calls().filter((method) => method === 'getOrgMembership').length;

/** The verdict the reporter was first given. */
export function reported(world: EvaluateWorld): Evaluation {
  const first = world.reporter.published.at(0);
  if (first === undefined) {
    throw new Error('nothing was published');
  }
  return first.evaluation;
}
