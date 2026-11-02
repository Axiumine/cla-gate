// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Decision, decide, type Requirement, type RoleFacts } from '../domain/authz.ts';
import type { InstallationRow } from './installation-state.ts';
import type { RoleViewer } from './org-admin.ts';
import { PROBE_BUDGETS, ProbeBudget } from './probe-budget.ts';
import { repoAdminFact } from './repo-admin.ts';
import type { DiscoverRepoAdminRole } from './repo-admin-discovery.ts';
import type { RepositoryRow } from './repository-rows.ts';
import type { RoleLookupMode, RoleLookups } from './role-lookups.ts';

// What a person may do in one tenant (E11-S05): the role facts of E11-S02 to E11-S04, resolved for one call and handed to
// the pure `decide` of src/server/domain/authz.ts. No HTTP in here: the guard of the HTTP edge turns the answer into a
// status. A failure to learn a role (GitHub down or limiting, the person's lookups used up) is thrown as it is and is never
// an answer, so no failure becomes an allow, a `none` role or a denial the person could mistake for "you may not".

export interface TenantAuthorizationDeps {
  /** The role lookups behind the cache of E11-S04, by what the route does: a `write` asks GitHub again. */
  readonly lookups: Readonly<Record<RoleLookupMode, RoleLookups>>;
  /** The role-in-installation rule (E11-S03), through the cached lookups; only the denial path runs it. */
  readonly discover: DiscoverRepoAdminRole;
}

/**
 * One call to decide: who asks, what for, and the stored rows of the tenant.
 * @internal Exported for the tests, which build questions (Knip ignores `@internal` exports in production mode).
 */
export interface TenantQuestion {
  readonly mode: RoleLookupMode;
  readonly requirement: Requirement;
  readonly installation: InstallationRow;
  /** The repository the call is about (never a removed one), or null for a call about the installation. */
  readonly repository: RepositoryRow | null;
  readonly viewer: RoleViewer;
  /** False for a suspended or deleted installation, whose roles cannot be asked of GitHub (its tokens are refused). */
  readonly active: boolean;
}

/** The answer: the viewer may proceed with the role they hold, or the call is forbidden, or it is as if the tenant did not exist. */
export type TenantAnswer =
  | { readonly decision: 'allow'; readonly role: Requirement }
  | { readonly decision: 'forbidden' }
  | { readonly decision: 'not_found' };

export type AuthorizeTenant = (question: TenantQuestion) => Promise<TenantAnswer>;

/** The facts about a live tenant, from the cached lookups: the org admin fact, then the repository one for anyone who is not. */
async function liveFacts(deps: TenantAuthorizationDeps, question: TenantQuestion): Promise<RoleFacts> {
  const { installation, repository, viewer } = question;
  const lookups = deps.lookups[question.mode];
  const orgAdmin = await lookups.orgAdmin(installation, viewer);
  const repoAdmin =
    repository !== null && (await repoAdminFact(orgAdmin, () => lookups.repoAdmin(installation, repository, viewer)));
  return { orgAdmin, repoAdmin, hasRoleInInstallation: orgAdmin || repoAdmin };
}

/**
 * The facts about a suspended or deleted tenant, with no GitHub call: GitHub refuses its installation tokens, so only what
 * the stored row says can be known. The owner of a user account is an org admin (their id is the account's); nobody else
 * can be verified.
 */
function inactiveFacts({ installation, viewer }: TenantQuestion): RoleFacts {
  const owner = installation.account_type === 'User' && installation.account_id === viewer.githubId;
  return { orgAdmin: owner, repoAdmin: false, hasRoleInInstallation: owner };
}

/** The decision with the role-in-installation rule applied to a `not_found`: a viewer who is admin somewhere here is forbidden, not unknown. */
async function decideWithDiscovery(
  deps: TenantAuthorizationDeps,
  question: TenantQuestion,
  facts: RoleFacts,
): Promise<Decision> {
  const decision = decide(question.requirement, facts);
  if (decision !== 'not_found' || !question.active) {
    return decision;
  }
  // The small budget of the denial path: a stranger who hits endpoints costs a few GitHub calls per installation, however often.
  const found = await deps.discover(question.viewer, question.installation.id, new ProbeBudget(PROBE_BUDGETS.denial));
  return found.role === 'repo_admin'
    ? decide(question.requirement, { ...facts, hasRoleInInstallation: true })
    : decision;
}

/**
 * The authorisation of a call over `deps`. A live tenant gets its facts from the cached lookups (the org admin fact, the
 * repository one for a call that names a repository, and for a viewer who is neither, the discovery of a role on any
 * repository of the installation with a repo-scoped document), a suspended or deleted one from the stored row alone.
 * The role of an `allow` is `org_admin` for an org admin and `repo_admin` for anyone else who passed.
 * @throws what the lookups throw: `GitHubUnavailableError`, `GitHubRateLimitedError`, `RoleLookupThrottledError`,
 * `InstallationNotAdmittedError`.
 */
export function createTenantAuthorization(deps: TenantAuthorizationDeps): AuthorizeTenant {
  return async (question) => {
    const facts = question.active ? await liveFacts(deps, question) : inactiveFacts(question);
    const decision = await decideWithDiscovery(deps, question, facts);
    return decision === 'allow' ? { decision, role: facts.orgAdmin ? 'org_admin' : 'repo_admin' } : { decision };
  };
}
