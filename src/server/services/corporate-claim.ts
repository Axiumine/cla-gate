// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { readVerifiedEmailDomains } from '../adapters/db/sessions-read.ts';
import type { CorporateGitHub } from './corporate-approval-lookup.ts';
import { type Claimant, matchClaim } from './corporate-claim-match.ts';
import { hasValidAgreement, listValidAgreements } from './corporate-claim-queries.ts';
import { type ClaimStatus, noMatchingApproval, writeClaim } from './corporate-claim-write.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import { resolveCorporateTarget } from './corporate-target.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The claim of an employee under an employer's corporate agreement (E21-S04): a contributor who writes for an employer asks to be covered
// without signing for themselves, and the answer comes from what the employer's CLA manager approved (E21-S03), never from what the
// contributor says. Two entry points: whether the repository offers the claim at all, and the claim. Neither says which company an
// agreement is of, and a refusal says to ask the employer's CLA manager, whoever the employer is.

/** What a claim needs: the database, the GitHub the membership of an organisation is asked on, and the queue the person's pull requests are re-evaluated through. */
export interface ClaimDeps {
  readonly db: Kysely<Database>;
  readonly github: CorporateGitHub;
  readonly enqueuer: JobEnqueuer;
}

/**
 * Whether a contributor can claim coverage for the repository: it has a corporate CLA in force and at least one agreement under it that is in
 * force (the signature is not revoked and it was signed under the major in force). A repository that does not exist, one whose organisation is
 * not served, and one with no corporate CLA are all `false`, so the answer teaches nothing about which tenants exist. Reads only.
 */
export async function corporateAvailable(db: Kysely<Database>, githubRepoId: number): Promise<boolean> {
  try {
    const { scope, document } = await resolveCorporateTarget(db, githubRepoId, 'read');
    return await hasValidAgreement(db, scope, { documentId: document.id, major: document.version.major });
  } catch (error) {
    if (error instanceof CorporateRuleError) {
      return false;
    }
    throw error;
  }
}

/**
 * Evaluates the claim of the person under the valid agreements of the repository's tenant and, when something covers them, writes it. In
 * order: the repository and its tenant (`not_found`, `installation_suspended`, `corporate_cla_not_configured`), the agreements in force
 * under the corporate document, the match (a call to GitHub that fails is `upstream_unavailable` and nothing has been written), then the write
 * under the lock of the agreement. A person nothing covers is `no_matching_approval`.
 * @returns `covered` when an approval was derived for the person, `already_covered` when they had one in force.
 * @throws CorporateRuleError the rules above.
 */
export async function claimCoverage(deps: ClaimDeps, claimant: Claimant, githubRepoId: number): Promise<ClaimStatus> {
  const { db, github } = deps;
  const target = await resolveCorporateTarget(db, githubRepoId, 'write');
  const { scope, document, repository } = target;
  const agreements = await listValidAgreements(db, scope, { documentId: document.id, major: document.version.major });
  const match = await matchClaim({
    db,
    github,
    scope,
    githubInstallationId: parseGithubId(repository.githubInstallationId),
    claimant,
    domains: await readVerifiedEmailDomains(db, claimant.sessionRowId),
    agreements,
  });
  if (match === null) {
    throw noMatchingApproval();
  }
  return writeClaim(deps, { target, match, claimant });
}
