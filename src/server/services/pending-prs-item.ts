// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { PendingReason } from '../domain/pending-reasons.ts';
import type { PendingRow } from './pending-prs-queries.ts';

// A pending pull request as the list tells it (E15-S07): a row of the statement, the reasons the pure function of
// domain/pending-reasons.ts gave for its stored details, and the logins of the accounts they name.

/** A row of the list with the reasons its stored details give. */
export interface FoundPending {
  readonly row: PendingRow;
  readonly reasons: readonly PendingReason[];
}

/** A reason with the display snapshot of its account: `login` comes with `githubId`, `null` when this instance has no `users` row for it. */
interface ListedReason {
  readonly code: PendingReason['code'];
  readonly githubId?: GithubId;
  readonly login?: string | null;
  readonly commitSha?: string;
}

/** A pending pull request as the list tells it. */
export interface PendingPr {
  readonly evaluationId: number;
  readonly repository: { readonly id: number; readonly fullName: string };
  readonly prNumber: number;
  readonly headSha: string;
  /** When the evaluation was last written. */
  readonly evaluatedAt: Date;
  readonly checkRunId: number | null;
  readonly reasons: readonly ListedReason[];
}

/** The numeric GitHub ids of the accounts the reasons of `found` name: the ones whose logins are read. */
export function accountsOf(found: FoundPending): number[] {
  return found.reasons.flatMap(({ githubId }) => (githubId === undefined ? [] : [githubId]));
}

/** The reason with the login of its account, read from `logins`; an account with no row has `null`. */
function withLogin(reason: PendingReason, logins: ReadonlyMap<number, string>): ListedReason {
  const { code, githubId, commitSha } = reason;
  return {
    code,
    ...(githubId === undefined ? {} : { githubId: parseGithubId(githubId), login: logins.get(githubId) ?? null }),
    ...(commitSha === undefined ? {} : { commitSha }),
  };
}

/** The pull request a row stands for, with its reasons named by `logins`. */
export function toPendingPr({ row, reasons }: FoundPending, logins: ReadonlyMap<number, string>): PendingPr {
  return {
    evaluationId: row.id,
    repository: { id: row.repository_id, fullName: row.full_name },
    prNumber: row.pr_number,
    headSha: row.head_sha,
    evaluatedAt: row.updated_at,
    checkRunId: row.check_run_id,
    reasons: reasons.map((reason) => withLogin(reason, logins)),
  };
}
