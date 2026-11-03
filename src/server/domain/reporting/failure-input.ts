// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ADVISORY_CODES, FAILURE_CODES, ROLES, UNLINKED_ROLES } from '../../../shared/pr-evaluation-codes.ts';
import type { DisplayNames } from './display-names.ts';

// E09-S03: what the failure report reads of an E08 evaluation. The domain layer imports only its own folder, so the evaluation
// is described by the fields this reads, as coverage-counts.ts does; the `Evaluation` of the engine has them all
// (domain/reporting-failure.test.ts hands the report real verdicts, so a change in its shape fails there). There is no email
// address among them: the `raw` identity of a finding is narrowed to its name.

export type ReportedRole = (typeof ROLES)[number];
export type ReportedUnlinkedRole = (typeof UNLINKED_ROLES)[number];

/** An account that took part in the pull request, and whether a signature or an allowlist entry covers it. */
interface ReportedActor {
  readonly account: { readonly id: number };
  readonly roles: readonly ReportedRole[];
  readonly covered: boolean;
}

/** An author or committer that GitHub could not link to an account, with the override that waives it (`null` for none). */
export interface ReportedFinding {
  readonly sha: string;
  readonly role: ReportedUnlinkedRole;
  readonly raw: { readonly name: string };
  readonly overrideId: number | null;
}

/** A finding that never blocks; the report names the unresolved co-authors of it. */
interface ReportedAdvisory {
  readonly code: (typeof ADVISORY_CODES)[number];
  readonly sha: string;
}

/** What to do about an actor: only the fix codes that say an account cannot sign carry weight here, and those name an id. */
interface ReportedFix {
  readonly code: string;
  readonly githubId?: number;
}

/** What {@link failureReport} reads of an `Evaluation`. */
export interface ReportedEvaluation {
  readonly failureCodes: readonly (typeof FAILURE_CODES)[number][];
  readonly actors: readonly ReportedActor[];
  readonly findings: readonly ReportedFinding[];
  readonly advisories: readonly ReportedAdvisory[];
  readonly fixes: readonly ReportedFix[];
}

/** What a failure report is about: the evaluation, the names it needs, and where the sign page of the pull request is. */
export interface FailureRequest {
  readonly headSha: string;
  readonly evaluation: ReportedEvaluation;
  readonly names: DisplayNames;
  /** `repositories.github_repo_id`: stable across renames, the repository of the sign link. */
  readonly githubRepoId: number;
  readonly prNumber: number;
  /** `PUBLIC_BASE_URL`, the origin of this deployment. */
  readonly publicBaseUrl: string;
}
