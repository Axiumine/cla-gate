// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { findInstallationByGithubId } from './installation-queries.ts';
import type { CachedVerdict, OrgMembershipCache } from './org-membership-cache.ts';
import type { GitHubClient, GitHubOrgMembership } from './ports/github.ts';
import { GitHubForbiddenError } from './ports/github-errors.ts';

// Whether a person belongs to the organisation that installed the App (E07-S10): the exemption lookup of the evaluation job.
// It is built on `getOrgMembership`, the one adapter call for a membership. Membership is a fact about an id: the login is
// only the handle GitHub's route takes, so a person who took over a reused login is not taken for the member.

/**
 * What GitHub says about one person: `member` for an active member of the installing organisation, `not_member` for
 * everyone else, and `permission_missing` when the App lacks the Members permission and cannot tell. The evaluation
 * treats `permission_missing` as not exempt, so a missing permission can only deny.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export type OrgMembershipVerdict = CachedVerdict | 'permission_missing';

/** Who is asked about: the installation whose organisation counts, the person's numeric id, and the login that finds them. */
interface OrgMembershipQuery {
  readonly githubInstallationId: GithubId;
  readonly userGithubId: GithubId;
  /** The lookup handle: a display snapshot that GitHub resolves to an account, checked against `userGithubId`. */
  readonly login: string;
}

export interface OrgMembership {
  /**
   * @throws whatever the GitHub client throws for a rate limit (`GitHubRateLimitedError`), an outage
   * (`GitHubUnavailableError`) or an installation it does not serve: a lookup that failed is never an answer.
   */
  isOrgMember(query: OrgMembershipQuery): Promise<OrgMembershipVerdict>;
}

export interface OrgMembershipDeps {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly logger: Logger;
  /**
   * What GitHub said before, shared by every service of the process: the job builds a service per run, because its GitHub
   * client is bound to the signal of that run, so a cache of the service's own would be empty each time.
   */
  readonly cache: OrgMembershipCache;
}

/** `member` for an active membership of the person asked about: another id (a reused login) or a pending invitation is none. */
function verdictOf(membership: GitHubOrgMembership | null, userGithubId: GithubId): CachedVerdict {
  return membership?.state === 'active' && membership.userId === userGithubId ? 'member' : 'not_member';
}

/**
 * The service over `deps`. The organisation is the installation's own account (`installations.account_login`); an
 * installation of a user, or one that is not stored, has no members and no request is made for it. The answer is `member`
 * only for an `active` membership whose user id is the one asked about; a pending invitation, a missing membership and
 * another id are `not_member`. A 403 that is no rate limit (the client already told those apart) is `permission_missing`,
 * logged as `members_permission_missing` with the numeric installation id.
 *
 * What GitHub answered is kept in `deps.cache` per (installation, person): a `member` for 10 minutes, a `not_member` for 2.
 * A failed lookup and `permission_missing` are never kept, and an installation of a user or one that is not stored is
 * answered without a request and without being kept either.
 */
export function createOrgMembership(deps: OrgMembershipDeps): OrgMembership {
  return {
    async isOrgMember({ githubInstallationId, userGithubId, login }) {
      const held = deps.cache.get(githubInstallationId, userGithubId);
      if (held !== undefined) {
        return held;
      }
      const installation = await findInstallationByGithubId(deps.db, githubInstallationId);
      if (installation?.account_type !== 'Organization') {
        return 'not_member';
      }
      try {
        const verdict = verdictOf(
          await deps.github.getOrgMembership(githubInstallationId, installation.account_login, login),
          userGithubId,
        );
        deps.cache.set(githubInstallationId, userGithubId, verdict);
        return verdict;
      } catch (error) {
        if (error instanceof GitHubForbiddenError) {
          deps.logger.warn({ githubInstallationId }, 'members_permission_missing');
          return 'permission_missing';
        }
        throw error;
      }
    },
  };
}
