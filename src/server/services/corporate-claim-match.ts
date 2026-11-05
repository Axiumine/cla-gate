// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { domainApprovals } from './corporate-approval-coverage-queries.ts';
import { type CorporateGitHub, lookedUp } from './corporate-approval-lookup.ts';
import {
  type ClaimAgreement,
  findUserApproval,
  listOrgApprovals,
  type OrgApproval,
} from './corporate-claim-queries.ts';

// Which approval covers the person who claims (E21-S04). The agreements in force are walked in ascending id and, under each, three things are
// tried in order: an approval of the person themselves in force, an approval of the domain of one of the addresses GitHub verified at login,
// and an approval of an organisation the person shows a membership of. The first match wins and nothing after it is asked, so a domain never
// costs a call to GitHub and an organisation is only looked at when nothing cheaper matched. Everything here reads; the write is
// `corporate-claim-write.ts`, which asks again under the lock of the agreement.

/**
 * The most organisations one claim checks on GitHub, over all agreements, in the order of their approvals. A person works for a handful of
 * employers and an employer approves a handful of organisations; the cap is what stops a claim from turning into hundreds of calls.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_ORG_CHECKS = 25;

/** The person who claims: the account of the session, by `users.id` and by the numeric GitHub id, and the session that holds their domains. */
export interface Claimant {
  readonly userId: number;
  readonly githubId: GithubId;
  /** The login snapshot of the session: display only, and checked against the numeric id before a membership is asked for it. */
  readonly login: string;
  /** `sessions.id`, where the domains of the verified addresses were kept at login. */
  readonly sessionRowId: number;
}

/** What a claim is evaluated for: the tenant, the agreements in force under the repository's corporate document and the person. */
export interface ClaimQuestion {
  readonly db: Kysely<Database>;
  readonly github: CorporateGitHub;
  readonly scope: TenantScope;
  /** The id GitHub gave the installation: the token the calls to GitHub are made with is the tenant's own. */
  readonly githubInstallationId: GithubId;
  readonly claimant: Claimant;
  /** The domains of the claimant's verified addresses, in the stored form (lower case, punycode). */
  readonly domains: readonly string[];
  readonly agreements: readonly ClaimAgreement[];
}

/** The approval that covers the claimant, and the agreement it is under: their own approval, or the domain or organisation approval a new one derives from. */
export type ClaimMatch =
  | { readonly agreement: ClaimAgreement; readonly via: 'user'; readonly approvalId: number }
  | { readonly agreement: ClaimAgreement; readonly via: 'rule'; readonly parentId: number };

/**
 * For each agreement, the lowest id of the approvals in force of a domain the claimant has a verified address in. The comparison is the
 * exact equality of the stored form, in the tenant's own rows (`domainApprovals`): `evilacme.com` and `acme.com.evil.test` are not `acme.com`.
 */
async function domainParents(question: ClaimQuestion): Promise<Map<number, number>> {
  const { db, scope } = question;
  const found = await Promise.all(question.domains.map((domain) => domainApprovals(db, scope, domain)));
  const parents = new Map<number, number>();
  for (const { approvalId, agreementId } of found.flat()) {
    const known = parents.get(agreementId);
    if (known === undefined || approvalId < known) {
      parents.set(agreementId, approvalId);
    }
  }
  return parents;
}

/**
 * Whether the account GitHub has under the login of the session is the person of the session. A login is a snapshot and may have been
 * given up and taken by somebody else since the session began; the numeric id is the identity, and a membership is never asked for a
 * login that does not lead to it.
 */
async function ownsLogin(question: ClaimQuestion): Promise<boolean> {
  const { github, githubInstallationId, claimant } = question;
  const account = await lookedUp(() => github.getUserAccount(githubInstallationId, claimant.login));
  return account !== null && account.type === 'User' && account.id === claimant.githubId;
}

/** Whether the claimant shows a membership of the organisation the approval names: the organisation by its login must be that very id. */
async function showsMembership(
  question: ClaimQuestion,
  org: OrgApproval & { readonly login: string },
): Promise<boolean> {
  const { github, githubInstallationId, claimant } = question;
  const account = await lookedUp(() => github.getOrganizationAccount(githubInstallationId, org.login));
  if (account?.id !== org.orgGithubId) {
    return false;
  }
  return lookedUp(() => github.isPublicOrgMember(githubInstallationId, account.login, claimant.login));
}

/**
 * The rule of the organisations: a function from an agreement to the id of the approval of the first organisation the claimant shows a
 * membership of, or `null`. The login of the claimant is checked once, when the first organisation needs it, and the budget of
 * {@link MAX_ORG_CHECKS} is shared by every agreement of the claim. An approval with no login snapshot cannot be asked about and is skipped.
 * @throws CorporateRuleError `upstream_unavailable` when GitHub fails or does not answer in time.
 */
function organisationRule(question: ClaimQuestion): (agreement: ClaimAgreement) => Promise<number | null> {
  let owner: Promise<boolean> | undefined;
  let budget = MAX_ORG_CHECKS;
  return async (agreement) => {
    const orgs = await listOrgApprovals(question.db, question.scope, { agreementId: agreement.id, limit: budget });
    budget -= orgs.length;
    for (const org of orgs.flatMap((row) => (row.login === null ? [] : [{ ...row, login: row.login }]))) {
      owner ??= ownsLogin(question);
      if (!(await owner)) {
        return null;
      }
      if (await showsMembership(question, org)) {
        return org.approvalId;
      }
    }
    return null;
  };
}

/** What covers the claimant under one agreement: their own approval in force, else the approval of a domain or an organisation, else nothing. */
async function matchAgreement(
  question: ClaimQuestion,
  at: {
    readonly agreement: ClaimAgreement;
    readonly parents: ReadonlyMap<number, number>;
    readonly organisation: (agreement: ClaimAgreement) => Promise<number | null>;
  },
): Promise<ClaimMatch | null> {
  const { agreement, parents, organisation } = at;
  const own = await findUserApproval(question.db, question.scope, {
    agreementId: agreement.id,
    githubId: question.claimant.githubId,
  });
  if (own?.inForce === true) {
    return { agreement, via: 'user', approvalId: own.id };
  }
  const parentId = parents.get(agreement.id) ?? (await organisation(agreement));
  return parentId === null ? null : { agreement, via: 'rule', parentId };
}

/**
 * The first approval that covers the claimant: agreements in ascending id, and in each one the person's own approval in force, then an
 * approval of the domain of a verified address, then an approval of an organisation they show a membership of. An approval of the
 * person that has expired does not match, and is left for the write to replace.
 * @returns the match, or `null` when nothing covers the claimant.
 * @throws CorporateRuleError `upstream_unavailable` when a call to GitHub fails; nothing has been written.
 */
export async function matchClaim(question: ClaimQuestion): Promise<ClaimMatch | null> {
  const parents = await domainParents(question);
  const organisation = organisationRule(question);
  for (const agreement of question.agreements) {
    const match = await matchAgreement(question, { agreement, parents, organisation });
    if (match !== null) {
      return match;
    }
  }
  return null;
}
