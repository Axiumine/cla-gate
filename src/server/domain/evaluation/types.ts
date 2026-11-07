// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type {
  ADVISORY_CODES,
  ALLOWLIST_KINDS,
  ALLOWLIST_SCOPES,
  FAILURE_CODES,
  LISTING_STATES,
  OUTCOMES,
  ROLES,
} from '../../../shared/pr-evaluation-codes.ts';

// E08-S01: the vocabulary of the pure PR evaluation engine. Everything the engine knows about a pull request arrives as
// the plain, readonly data below; nothing in it is a name, login or email except the two display-only raw identities of
// a commit, so a rule can never be written against text that an attacker chooses.

export {
  ADVISORY_CODES,
  ALLOWLIST_KINDS,
  ALLOWLIST_SCOPES,
  FAILURE_CODES,
  ROLES,
} from '../../../shared/pr-evaluation-codes.ts';

/** What the fix hints tell a maintainer or a contributor to do (rendered by E09). */
export const FIX_CODES = [
  'sign_cla',
  'allowlist_bot',
  'allowlist_account',
  'link_commit_email',
  'maintainer_override',
  'split_pull_request',
] as const;

/** `Unknown` is only for a co-author resolved from a trailer, whose account type GitHub never told us (E08-S06). */
export const ACCOUNT_TYPES = ['User', 'Bot', 'Organization', 'Mannequin', 'Unknown'] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];
export type Role = (typeof ROLES)[number];
export type FixCode = (typeof FIX_CODES)[number];
export type AdvisoryCode = (typeof ADVISORY_CODES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AllowlistKind = (typeof ALLOWLIST_KINDS)[number];
export type AllowlistScope = (typeof ALLOWLIST_SCOPES)[number];
export type ListingState = (typeof LISTING_STATES)[number];
export type Outcome = (typeof OUTCOMES)[number];

/**
 * A GitHub account as the engine sees it. `id` is the numeric GitHub id (a positive safe integer) and the only identity.
 * There is no login, name or email here on purpose, so classification cannot depend on them. `appSlug` is display
 * metadata for the renderer and never changes a decision.
 */
export interface Account {
  readonly id: number;
  readonly type: AccountType;
  readonly appSlug?: string;
}

/** The author or committer line of a commit as git recorded it. Display-only, and the only personal data in the input. */
export interface RawIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * One commit of the pull request. `author` and `committer` are `null` for an unlinked identity: the adapter maps
 * GitHub's `null` and `{}` to it (E07-S04). `parents` are commit SHAs, lower case.
 */
export interface CommitFacts {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly author: Account | null;
  readonly committer: Account | null;
  readonly message: string;
  readonly rawAuthor: RawIdentity;
  readonly rawCommitter: RawIdentity;
}

/**
 * A finding that never blocks a pull request, only informs the maintainer (E08-S06). It names a commit and a code and
 * nothing else: no name, login or email of the trailer it is about.
 */
export interface Advisory {
  readonly code: AdvisoryCode;
  readonly sha: string;
}

/** The CLA a repository enforces: one document, and the major version signatures must match. `null` means none. */
export interface Policy {
  readonly documentId: number;
  readonly activeMajor: number;
}

/** A signature that may cover an actor. Minor versions are not part of the input and no rule may depend on one. */
export interface SignatureFact {
  readonly id: number;
  readonly githubId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly major: number;
  readonly revoked: boolean;
}

/** An allowlist entry. `githubId` is a user, a bot account or an organisation id depending on `kind`. */
export interface AllowlistEntry {
  readonly id: number;
  readonly kind: AllowlistKind;
  readonly githubId: number;
  readonly scope: AllowlistScope;
}

/**
 * The approval that covers a person under a corporate agreement (E21-S05): the agreement and the approval, by their
 * ids. The loader hands over one for a person, the one of the lowest approval id when several are in force, so the
 * basis the engine records does not depend on the order of any list.
 */
export interface CorporateCover {
  readonly agreementId: number;
  readonly approvalId: number;
}

/**
 * Every fact the engine needs, handed over as data (E07-S04 builds it). `orgMembers` maps an organisation id to the user
 * ids known to belong to it; an organisation without an entry has no known members. `overrides` maps a commit SHA to the
 * `commit_overrides` id that waives its unlinked identities. `corporateCovered` maps the numeric id of a person to the
 * approval that covers them under a corporate agreement in force (E21-S05: not revoked, not expired, the agreement's
 * signature not revoked, its major the active one of the repository's corporate document); `corporateOutdated` holds the
 * people who hold an approval in force under an agreement of an earlier major, which covers nobody, so the report can
 * tell them to ask the CLA manager to sign the current version. Neither holds a name, a domain or a company.
 */
export interface EvaluationInput {
  readonly headSha: string;
  readonly opener: Account;
  readonly commits: readonly CommitFacts[];
  readonly listing: ListingState;
  readonly policy: Policy | null;
  readonly signatures: readonly SignatureFact[];
  readonly allowlist: readonly AllowlistEntry[];
  readonly orgMembers: ReadonlyMap<number, ReadonlySet<number>>;
  readonly overrides: ReadonlyMap<string, number>;
  readonly corporateCovered: ReadonlyMap<number, CorporateCover>;
  readonly corporateOutdated: ReadonlySet<number>;
}

export interface SignatureBasis {
  readonly kind: 'signature';
  readonly signatureId: number;
  readonly versionId: number;
  readonly major: number;
}

export interface AllowlistBasis {
  readonly kind: 'allowlist';
  readonly entryId: number;
  readonly entryKind: AllowlistKind;
  readonly scope: AllowlistScope;
}

/** An approval of a corporate agreement covers the person (E21-S05); the ids are numeric and name no company, domain or login. */
export interface CorporateApprovalBasis {
  readonly kind: 'corporate_approval';
  readonly agreementId: number;
  readonly approvalId: number;
}

/**
 * Why an actor is covered. A union discriminated on `kind`, one interface per member: E21-S05 added `corporate_approval`
 * as a new member without touching a branch that already exists.
 */
export type CoveringBasis = SignatureBasis | AllowlistBasis | CorporateApprovalBasis;
