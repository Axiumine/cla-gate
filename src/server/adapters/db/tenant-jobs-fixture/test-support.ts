// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import { parseGithubId } from '../../../../shared/github-id.ts';
import type { PrEvaluationDetails } from '../../../../shared/pr-evaluation-details.ts';
import { detailsOfFailure } from '../../../domain/merge-group.ts';
import { headShasToCancel } from '../../../services/close-pr/close-heads.ts';
import { cancelEvaluation, evaluationsOfPullRequest } from '../../../services/close-pr/close-rows.ts';
import { latestEvaluationPerPr } from '../../../services/current-evaluation-queries.ts';
import {
  evaluationsAtHead,
  failEvaluation,
  findEvaluation,
  finishEvaluation,
  setPullRequestState,
  startEvaluation,
} from '../../../services/evaluate-pr/evaluation-rows.ts';
import { readAllowlist, readOverrides, readPolicy } from '../../../services/evaluate-pr/policy-facts.ts';
import { readSignatures } from '../../../services/evaluate-pr/signature-facts.ts';
import { unfinishedPullRequests } from '../../../services/finalise/finalise-rows.ts';
import { markGroupDestroyed } from '../../../services/merge-group/merge-group-destroyed.ts';
import { failGroupEvaluation } from '../../../services/merge-group/merge-group-failure.ts';
import {
  finishGroupEvaluation,
  recordGroupCheckRun,
  startGroupEvaluation,
} from '../../../services/merge-group/merge-group-progress.ts';
import { findGroupRow } from '../../../services/merge-group/merge-group-rows.ts';
import { evaluationStates, staleEvaluations } from '../../../services/sweep/sweep-rows.ts';
import { reconcilePullRequestStates } from '../../../services/sweep/sweep-state-rows.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import type { Refusal, ScopedQuery } from '../tenant-registry/test-support.ts';
import type { TenantScope } from '../tenant-scope.ts';

// The registry entries (E11-S06) of the statements the job queue runs over a tenant table (E07): the evaluation rows the
// evaluate-pr job writes and the close-pr job and the sweep read, and the policy facts and signatures the evaluation reads. Each
// entry names the installation that owns every row its call read or changed, found by reading the rows again. `twoTenants`
// stores, for each tenant, a finished evaluation (pull request 7), one still running (pull request 8), an override, an
// allowlist entry of the installation and one of the repository, and a signature, so a statement that strays has a row to meet.

/** The `Error` of a database that refused a row for a foreign key (`23503`): a repository that is another installation's. */
const isForeignKeyViolation: Refusal = (error) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';

/** What a statement that must change one row answers when the installation has none: a row of another tenant is none. */
const isNoRow: Refusal = (error) => error instanceof NoResultError;

/** The pull request and head SHA of the finished evaluation the fixture stores for each tenant. */
const FINISHED = { prNumber: 7, headSha: 'b'.repeat(40) } as const;
/** A pull request nobody evaluated yet: the writes of the evaluation job create a row for it. */
const UNSEEN = { prNumber: 901, headSha: 'd'.repeat(40) } as const;
/** The head SHA of the merge group the fixture stores for each tenant (E22-S01), and the base SHA it was built on. */
const GROUP = { headSha: '9'.repeat(40), baseSha: '8'.repeat(40) } as const;
/** A merge group nobody evaluated yet: the writes of the group job create a row for it. */
const UNSEEN_GROUP = { headSha: 'a'.repeat(40), baseSha: '8'.repeat(40) } as const;
/** The Check Run id the call that records one writes: no row of the fixture holds it. */
const RECORDED_CHECK_RUN = 777_777;
/** An instant after every row of the fixture was touched. */
const LATER = new Date('2100-01-01T00:00:00Z');
/** A verdict as the evaluation job stores it. It names no one. */
const VERDICT: PrEvaluationDetails = {
  version: 1,
  outcome: 'success',
  failureCodes: [],
  documentId: null,
  activeMajor: null,
  commitCount: 1,
  mergeCommitsSkipped: 0,
  listing: 'complete',
  actors: [],
  unlinked: [],
  advisories: [],
};

const scoped = (options: Pick<ScopedQuery, 'run'> & { readonly refusal?: Refusal }): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** The tenant and the repository of `ids`, in the scope the job modules take. */
const repositoryOf = (scope: TenantScope, ids: TenantWorld) => ({
  installationId: scope.installationId,
  repositoryId: ids.plain.repositoryId,
});

/** The installation that owns each evaluation with these row ids. */
async function ownersOfEvaluations(db: Kysely<Database>, evaluationIds: readonly number[]): Promise<number[]> {
  if (evaluationIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('pr_evaluations')
    .select('installation_id')
    .where('id', 'in', evaluationIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each row of one of the policy tables with these row ids. */
async function ownersOfPolicyRows(
  db: Kysely<Database>,
  table: 'allowlist_entries' | 'commit_overrides' | 'signatures' | 'cla_documents',
  ids: readonly number[],
): Promise<number[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db.selectFrom(table).select('installation_id').where('id', 'in', ids).execute();
  return rows.map((row) => row.installation_id);
}

/** The ids of the rows a call answered, none for the `null` of a group it did not meet. */
const idsOf = (...rows: readonly ({ readonly id: number } | null)[]): number[] =>
  rows.filter((row) => row !== null).map((row) => row.id);

/** The installation that owns each merge group row with these row ids. */
async function ownersOfGroups(db: Kysely<Database>, ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('merge_group_evaluations')
    .select('installation_id')
    .where('id', 'in', ids)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The id of the merge group row the fixture stores for the repository of `ids`. */
async function groupOf(db: Kysely<Database>, ids: TenantWorld): Promise<number> {
  const row = await db
    .selectFrom('merge_group_evaluations')
    .select('id')
    .where('repository_id', '=', ids.plain.repositoryId)
    .where('head_sha', '=', GROUP.headSha)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The id of the evaluation of the repository that is still running: the fixture stores one for each tenant. */
async function runningEvaluationOf(db: Kysely<Database>, repositoryId: number): Promise<number> {
  const row = await db
    .selectFrom('pr_evaluations')
    .select('id')
    .where('repository_id', '=', repositoryId)
    .where('result', '=', 'in_progress')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The evaluation rows of the repository of `ids` for these pull request numbers, found by reading the table. */
async function evaluationsOfRepository(
  db: Kysely<Database>,
  ids: TenantWorld,
  prNumbers: readonly number[],
): Promise<number[]> {
  const rows = await db
    .selectFrom('pr_evaluations')
    .select('id')
    .where('repository_id', '=', ids.plain.repositoryId)
    .where('pr_number', 'in', prNumbers)
    .execute();
  return rows.map((row) => row.id);
}

/** Every function that the job queue's modules export over a tenant table, by module and name. */
export const JOB_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, ScopedQuery>>>> = {
  'services/close-pr/close-heads.ts': {
    headShasToCancel: scoped({
      run: async (db, scope, ids) => {
        // The SHA of the finished evaluation is dropped from the answer exactly when another pull request of the repository was
        // evaluated at it, so the answer without it tells that the statement met that row.
        const kept = await headShasToCancel(db, repositoryOf(scope, ids), {
          prNumber: UNSEEN.prNumber,
          evaluations: [],
          currentHeadSha: FINISHED.headSha,
        });
        return kept.length === 0 ? ownersOfEvaluations(db, await evaluationsOfRepository(db, ids, [7])) : [];
      },
    }),
  },
  'services/close-pr/close-rows.ts': {
    evaluationsOfPullRequest: scoped({
      run: async (db, scope, ids) => {
        const rows = await evaluationsOfPullRequest(db, repositoryOf(scope, ids), FINISHED.prNumber);
        return ownersOfEvaluations(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
    cancelEvaluation: scoped({
      run: async (db, scope, ids) => {
        const running = await runningEvaluationOf(db, ids.plain.repositoryId);
        return (await cancelEvaluation(db, scope.installationId, running)) ? ownersOfEvaluations(db, [running]) : [];
      },
    }),
  },
  'services/evaluate-pr/evaluation-rows.ts': {
    findEvaluation: scoped({
      run: async (db, scope, ids) => {
        const stored = await findEvaluation(db, { ...repositoryOf(scope, ids), ...FINISHED });
        return stored === null ? [] : ownersOfEvaluations(db, [stored.id]);
      },
    }),
    startEvaluation: scoped({
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) =>
        ownersOfEvaluations(db, [await startEvaluation(db, { ...repositoryOf(scope, ids), ...UNSEEN }, 'open')]),
    }),
    finishEvaluation: scoped({
      refusal: isNoRow,
      run: async (db, scope, ids) => {
        const running = await runningEvaluationOf(db, ids.plain.repositoryId);
        await finishEvaluation(db, scope.installationId, running, VERDICT);
        return ownersOfEvaluations(db, [running]);
      },
    }),
    failEvaluation: scoped({
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) => {
        const failed = await failEvaluation(db, { ...repositoryOf(scope, ids), ...UNSEEN }, 'keep');
        return ownersOfEvaluations(
          db,
          [failed].filter((row) => row !== null),
        );
      },
    }),
    setPullRequestState: scoped({
      run: async (db, scope, ids) => {
        // The finished evaluation of pull request 7 is open: closing it changes one row of the tenant's own repository, and
        // nothing when the repository is another tenant's.
        const changed = await setPullRequestState(
          db,
          { ...repositoryOf(scope, ids), prNumber: FINISHED.prNumber },
          'closed',
        );
        return changed === 0
          ? []
          : ownersOfEvaluations(db, await evaluationsOfRepository(db, ids, [FINISHED.prNumber]));
      },
    }),
    evaluationsAtHead: scoped({
      run: async (db, scope, ids) => {
        const rows = await evaluationsAtHead(db, repositoryOf(scope, ids), FINISHED.headSha);
        return ownersOfEvaluations(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
  },
  'services/evaluate-pr/policy-facts.ts': {
    readPolicy: scoped({
      run: async (db, scope, ids) => {
        const policy = await readPolicy({ db, ...repositoryOf(scope, ids) }, ids.documentId);
        return policy === null ? [] : ownersOfPolicyRows(db, 'cla_documents', [policy.documentId]);
      },
    }),
    readAllowlist: scoped({
      run: async (db, scope, ids) => {
        const entries = await readAllowlist({ db, ...repositoryOf(scope, ids) });
        // The entries of the installation come with every repository; the entry of the repository alone is what the ids select.
        const ofRepository = entries.filter((entry) => entry.scope === 'repository');
        return ownersOfPolicyRows(
          db,
          'allowlist_entries',
          ofRepository.map((entry) => entry.id),
        );
      },
    }),
    readOverrides: scoped({
      run: async (db, scope, ids) => {
        const overrides = await readOverrides({ db, ...repositoryOf(scope, ids) }, ['a'.repeat(40)]);
        return ownersOfPolicyRows(db, 'commit_overrides', [...overrides.values()]);
      },
    }),
  },
  'services/evaluate-pr/signature-facts.ts': {
    readSignatures: scoped({
      run: async (db, scope, ids) => {
        const facts = await readSignatures({ db, ...repositoryOf(scope, ids) }, ids.documentId, [ids.signer.githubId]);
        return ownersOfPolicyRows(
          db,
          'signatures',
          facts.map((fact) => fact.id),
        );
      },
    }),
  },
  'services/finalise/finalise-rows.ts': {
    unfinishedPullRequests: scoped({
      run: async (db, scope, ids) => {
        // The fixture stores a pull request still running (8) for each tenant, which the walk finds under the tenant's own ids.
        const found = await unfinishedPullRequests(db, repositoryOf(scope, ids), { after: 0, limit: 50 });
        return found.length === 0 ? [] : ownersOfEvaluations(db, await evaluationsOfRepository(db, ids, found));
      },
    }),
  },
  'services/current-evaluation-queries.ts': {
    latestEvaluationPerPr: scoped({
      run: async (db, scope, ids) => {
        const rows = await latestEvaluationPerPr(db, scope.installationId, [ids.plain.repositoryId]).execute();
        return ownersOfEvaluations(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
  },
  'services/sweep/sweep-rows.ts': {
    evaluationStates: scoped({
      run: async (db, scope, ids) => {
        const states = await evaluationStates(db, repositoryOf(scope, ids), [FINISHED.prNumber]);
        return states.size === 0 ? [] : ownersOfEvaluations(db, await evaluationsOfRepository(db, ids, [7]));
      },
    }),
    staleEvaluations: scoped({
      run: async (db, scope, ids) => {
        const rows = await staleEvaluations(db, repositoryOf(scope, ids), LATER);
        return ownersOfEvaluations(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
  },
  'services/sweep/sweep-state-rows.ts': {
    reconcilePullRequestStates: scoped({
      run: async (db, scope, ids) => {
        // A listing with no pull request closes the latest row of both pull requests the fixture stores for the repository, GitHub agreeing.
        const corrected = await reconcilePullRequestStates(
          db,
          repositoryOf(scope, ids),
          { open: [], listedAt: LATER },
          () => Promise.resolve(false),
        );
        return corrected.closed === 0 ? [] : ownersOfEvaluations(db, await evaluationsOfRepository(db, ids, [7, 8]));
      },
    }),
  },
  'services/merge-group/merge-group-rows.ts': {
    findGroupRow: scoped({
      run: async (db, scope, ids) => {
        const found = await findGroupRow(db, { ...repositoryOf(scope, ids), headSha: GROUP.headSha });
        return found === null ? [] : ownersOfGroups(db, [found.id]);
      },
    }),
  },
  'services/merge-group/merge-group-progress.ts': {
    startGroupEvaluation: scoped({
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) => {
        const started = await startGroupEvaluation(
          db,
          { ...repositoryOf(scope, ids), headSha: UNSEEN_GROUP.headSha },
          UNSEEN_GROUP.baseSha,
        );
        return ownersOfGroups(db, idsOf(started));
      },
    }),
    finishGroupEvaluation: scoped({
      run: async (db, scope, ids) => {
        const id = await groupOf(db, ids);
        const finished = await finishGroupEvaluation(
          db,
          scope.installationId,
          id,
          detailsOfFailure('evaluation_failed'),
        );
        return finished ? ownersOfGroups(db, [id]) : [];
      },
    }),
    recordGroupCheckRun: scoped({
      run: async (db, scope, ids) => {
        const id = await groupOf(db, ids);
        await recordGroupCheckRun(db, scope.installationId, id, RECORDED_CHECK_RUN);
        // The call answers nothing, so the row is read again: it is changed exactly when it holds the id that was written.
        const changed = await db
          .selectFrom('merge_group_evaluations')
          .select('id')
          .where('id', '=', id)
          .where('check_run_id', '=', RECORDED_CHECK_RUN)
          .execute();
        return ownersOfGroups(
          db,
          changed.map((row) => row.id),
        );
      },
    }),
  },
  'services/merge-group/merge-group-failure.ts': {
    failGroupEvaluation: scoped({
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) => {
        const failed = await failGroupEvaluation(
          db,
          { ...repositoryOf(scope, ids), headSha: UNSEEN_GROUP.headSha },
          UNSEEN_GROUP.baseSha,
        );
        return ownersOfGroups(db, idsOf(failed));
      },
    }),
  },
  'services/merge-group/merge-group-destroyed.ts': {
    markGroupDestroyed: scoped({
      run: async (db, scope, ids) => {
        const id = await groupOf(db, ids);
        const installation = await db
          .selectFrom('installations')
          .select('github_installation_id')
          .where('id', '=', scope.installationId)
          .executeTakeFirstOrThrow();
        await markGroupDestroyed(db, {
          githubInstallationId: parseGithubId(installation.github_installation_id),
          githubRepoId: ids.plain.githubRepoId,
          headSha: GROUP.headSha,
          baseSha: GROUP.baseSha,
        });
        // The call answers nothing, so the row is read again: it is changed exactly when it is destroyed now.
        const changed = await db
          .selectFrom('merge_group_evaluations')
          .select('id')
          .where('id', '=', id)
          .where('destroyed_at', 'is not', null)
          .execute();
        return ownersOfGroups(
          db,
          changed.map((row) => row.id),
        );
      },
    }),
  },
};
