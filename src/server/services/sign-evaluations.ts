// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import {
  FAILING_LOOKUP_ROWS,
  listsUncovered,
  MAX_FAILING_PULL_REQUESTS,
  signatureEvaluationKey,
} from '../domain/signature-evaluations.ts';
import { findFailingEvaluations } from './failing-evaluation-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The evaluations a new signature asks for (E13-S07). A red check turns green when the person signs, without waiting for the
// next push or the scheduled sweep: the pull request the person came from is evaluated again, and so is every other pull request
// of the tenant whose stored failure names the person as uncovered. The jobs are sent on the connection of the transaction that
// inserted the signature, so a job cannot start before the signature is committed, and a send that fails takes the signature back.
// The job (E07-S04) reads the pull request and then the signatures last, so it sees the signature this transaction wrote.

/** The pull request a job is sent for: the repository by GitHub's id, and the number. */
interface PullRequestRef {
  readonly githubRepoId: GithubId;
  readonly prNumber: number;
}

/** A signature that was just inserted, and where its signer came from. */
export interface RecordedSignature {
  /** The tenant of the signature: every read here carries its installation id. */
  readonly scope: TenantScope;
  /** GitHub's id of the installation, which the envelope of a job names. */
  readonly githubInstallationId: number;
  readonly signatureId: number;
  /** The document that was signed: only the repositories attached to it are looked at. */
  readonly documentId: number;
  /** The signer by the numeric GitHub id, which is what a stored failure names. */
  readonly signer: GithubId;
  /** The repository the signing came from, and the pull request when the request named one (the dashboard names none). */
  readonly source: {
    readonly repositoryId: number;
    readonly githubRepoId: number;
    readonly prNumber: number | null;
  };
}

/**
 * The other pull requests of the tenant that fail for the signer, newest first, at most {@link MAX_FAILING_PULL_REQUESTS}: the
 * latest stored evaluation of each pull request of a repository attached to the document is a failure that lists the signer's
 * numeric id among the uncovered identities. The pull request the signing came from is left out, and a pull request appears once.
 */
async function failingPullRequests(trx: Transaction<Database>, signed: RecordedSignature): Promise<PullRequestRef[]> {
  const { source } = signed;
  const rows = await findFailingEvaluations(trx, signed.scope, {
    documentId: signed.documentId,
    githubId: signed.signer,
    origin: source.prNumber === null ? null : { repositoryId: source.repositoryId, prNumber: source.prNumber },
    limit: FAILING_LOOKUP_ROWS,
  });
  return rows
    .filter((row) => listsUncovered(row.details, signed.signer))
    .slice(0, MAX_FAILING_PULL_REQUESTS)
    .map((row) => ({ githubRepoId: parseGithubId(row.githubRepoId), prNumber: row.prNumber }));
}

/** The pull request the signing came from, or none when the request named no pull request. */
function originPullRequest({ source }: RecordedSignature): PullRequestRef[] {
  return source.prNumber === null
    ? []
    : [{ githubRepoId: parseGithubId(source.githubRepoId), prNumber: source.prNumber }];
}

/**
 * Sends an `evaluate-pr` job with the trigger `signature` for the pull request the person signed from (when there is one) and for
 * their other failing pull requests of the tenant, in the transaction `trx` that holds the new signature. Each send is keyed by the
 * signature, the repository and the pull request, and carries no coalesce key and no window, so none is dropped for another job
 * that waits (the queue serialises the jobs of one pull request instead). A pull request that was closed meanwhile is harmless:
 * the job sees the state at run time and does nothing.
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and the signature with it.
 */
export async function enqueueSignatureEvaluations(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  signed: RecordedSignature,
): Promise<void> {
  const githubInstallationId = parseGithubId(signed.githubInstallationId);
  const targets = [...originPullRequest(signed), ...(await failingPullRequests(trx, signed))];
  for (const { githubRepoId, prNumber } of targets) {
    await enqueuer.enqueue(
      trx,
      { type: 'evaluate-pr', githubInstallationId, githubRepoId, prNumber, trigger: 'signature' },
      { idempotencyKey: signatureEvaluationKey(signed.signatureId, githubRepoId, prNumber) },
    );
  }
}
