// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { AllowlistEntry, EvaluationInput, ExtractedActor, Policy } from '../../domain/evaluation/index.ts';
import type { OrgMembership } from '../org-membership.ts';
import type { GitHubCommit, GitHubPullRequest } from '../ports/github.ts';
import { type Candidate, lookupCandidates, readOrgMembers } from './org-facts.ts';
import type { PolicyScope } from './policy-facts.ts';
import { readSignatures } from './signature-facts.ts';

// The organisation membership fact of an evaluation (E07-S04, step 5): who is worth asking GitHub about, and what GitHub said.

/** What the membership of the installing organisation is read for. */
export interface OrgMembersRequest {
  readonly membership: OrgMembership;
  readonly scope: PolicyScope;
  /** The installation in GitHub's terms: what the lookups are made as. */
  readonly githubInstallationId: GithubId;
  /** The id of the installing organisation. */
  readonly orgId: number;
  readonly pr: GitHubPullRequest;
  readonly commits: readonly GitHubCommit[];
  readonly policy: Policy | null;
  readonly allowlist: readonly AllowlistEntry[];
  readonly actors: readonly ExtractedActor[];
}

/** The accounts the job saw in the pull request and its commits, by numeric id, with the login each was seen under. */
function seenAccounts(pr: GitHubPullRequest, commits: readonly GitHubCommit[]): Map<number, Candidate> {
  const seen = new Map<number, Candidate>();
  for (const ref of [pr.opener, ...commits.flatMap((commit) => [commit.author, commit.committer])]) {
    if (ref !== null && !seen.has(ref.id)) {
      seen.set(ref.id, { id: ref.id, login: ref.login });
    }
  }
  return seen;
}

/**
 * The membership of the installing organisation for the people the allowlist could exempt: the ones that hold no covering
 * signature and match no `user` or `bot` entry. A preliminary read of the signatures of the people who could be asked about
 * decides who is worth a request; the signatures the engine takes are read once more, last.
 */
export async function readOrgMemberFacts(request: OrgMembersRequest): Promise<EvaluationInput['orgMembers']> {
  const { membership, scope, githubInstallationId, orgId, pr, policy, allowlist, actors } = request;
  const base = { actors, allowlist, seen: seenAccounts(pr, request.commits), orgId };
  const possible = lookupCandidates({ ...base, signed: new Set() });
  if (possible.length === 0) {
    return new Map();
  }
  const covering =
    policy === null
      ? []
      : await readSignatures(
          scope,
          policy.documentId,
          possible.map((person) => person.id),
        );
  const signed = new Set(covering.filter((fact) => fact.major === policy?.activeMajor).map((fact) => fact.githubId));
  return readOrgMembers(membership, githubInstallationId, orgId, lookupCandidates({ ...base, signed }));
}
