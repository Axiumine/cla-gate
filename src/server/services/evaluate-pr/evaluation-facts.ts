// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import {
  addCoAuthors,
  type EvaluationInput,
  type ExtractedActor,
  extractActors,
} from '../../domain/evaluation/index.ts';
import type { InstallationRow } from '../installation-state.ts';
import type { OrgMembership } from '../org-membership.ts';
import type { GitHubPullRequest } from '../ports/github.ts';
import type { RepositoryRow } from '../repository-rows.ts';
import { commitFacts } from './commit-facts.ts';
import type { Listed } from './commit-listing.ts';
import { readCorporateFacts } from './corporate-facts.ts';
import { readOrgMemberFacts } from './org-members.ts';
import { type PolicyScope, readAllowlist, readOverrides, readPolicy } from './policy-facts.ts';
import { readSignatures } from './signature-facts.ts';

// The facts of one evaluation as the engine takes them (E07-S04, steps 5 and 6): the policy of the repository, then the
// organisation membership of the people who still need it, and the signatures and the corporate approvals last. A
// signature is the one fact that a person can create while the job runs (they sign in another tab), and a corporate approval
// (E21-S05) another, so they are read after everything that takes time, and as late as possible before the verdict.
// Everything is read as plain data by numeric id: a login reaches no rule.

/** The stored tenant an evaluation is for: the installation and the repository, as the job loaded them. */
export interface Tenant {
  readonly installation: InstallationRow;
  readonly repository: RepositoryRow;
}

export interface FactsDeps {
  readonly db: PolicyScope['db'];
  readonly orgMembership: OrgMembership;
}

/** What the facts are read for: the tenant, the pull request as step 2 fetched it, and its commits. */
export interface FactsRequest {
  /** The key of the installation in GitHub's terms: what the membership lookup is made as. */
  readonly githubInstallationId: GithubId;
  readonly tenant: Tenant;
  readonly pr: GitHubPullRequest;
  readonly listed: Listed;
}

/** The numeric ids of `actors`: whose signatures are read. */
const idsOf = (actors: readonly ExtractedActor[]): number[] => actors.map((actor) => actor.account.id);

/** What is read before the actors are known: the input of the engine with no signature, no membership and no corporate cover yet. */
interface Read {
  readonly commits: EvaluationInput['commits'];
  readonly policy: EvaluationInput['policy'];
  readonly allowlist: EvaluationInput['allowlist'];
  readonly overrides: EvaluationInput['overrides'];
}

/** The input of the engine from the pull request and what was read first; the reads that need the actors fill the rest. */
function draftOf({ pr, listed }: FactsRequest, read: Read): EvaluationInput {
  return {
    headSha: pr.headSha,
    opener: { id: pr.opener.id, type: pr.opener.type },
    listing: listed.listing,
    signatures: [],
    orgMembers: new Map(),
    corporateCovered: new Map(),
    corporateOutdated: new Set(),
    ...read,
  };
}

/**
 * The input of the engine for one pull request, read in this order: the CLA in force, the allowlist, the overrides of the
 * collected commits, the organisation membership, the signatures (one query for the distinct actors on the active document that
 * are not revoked) and last the corporate approvals (E21-S05, one query for the same actors). Every read filters by the
 * installation of the tenant.
 */
export async function readEvaluationInput(deps: FactsDeps, request: FactsRequest): Promise<EvaluationInput> {
  const { tenant, pr, listed } = request;
  const scope: PolicyScope = {
    db: deps.db,
    installationId: tenant.installation.id,
    repositoryId: tenant.repository.id,
  };
  const commits = listed.commits.map(commitFacts);
  const policy = await readPolicy(scope, tenant.repository.cla_document_id);
  const allowlist = await readAllowlist(scope);
  const overrides = await readOverrides(
    scope,
    commits.map((commit) => commit.sha),
  );
  const draft = draftOf(request, { commits, policy, allowlist, overrides });
  const { actors } = addCoAuthors(extractActors(draft), commits);
  const members = await readOrgMemberFacts({
    membership: deps.orgMembership,
    scope,
    githubInstallationId: request.githubInstallationId,
    orgId: tenant.installation.account_id,
    pr,
    commits: listed.commits,
    policy,
    allowlist,
    actors,
  });
  const signatures = policy === null ? [] : await readSignatures(scope, policy.documentId, idsOf(actors));
  const corporate = await readCorporateFacts(scope, {
    policy,
    corporateDocumentId: tenant.repository.corporate_document_id,
    githubIds: idsOf(actors),
  });
  return {
    ...draft,
    orgMembers: members,
    signatures,
    corporateCovered: corporate.covered,
    corporateOutdated: corporate.outdated,
  };
}
