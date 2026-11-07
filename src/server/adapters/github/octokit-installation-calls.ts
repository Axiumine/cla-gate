// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubOrgMembership, GitHubRepository, GitHubRepositoryPermission } from '../../services/ports/github.ts';
import {
  answeredUnlessForbidden,
  type Channel,
  pager,
  type RequestHeaders,
  readOrNull,
  readOrNullWhenForbidden,
} from './octokit-request.ts';
import { collectPages } from './pagination.ts';
import {
  membersProbeSchema,
  orgMembershipSchema,
  repositoryPageSchema,
  repositoryPermissionSchema,
  repositorySchema,
} from './schemas.ts';

// The requests the GitHub client port makes with an installation's token (E05-S04): `headers` carry the token. Route
// templates name a route in errors and are what Octokit expands. `channel` is the installation's lane in the rate
// limiter (E05-S05).

export function fetchRepositories(channel: Channel, headers: RequestHeaders): Promise<GitHubRepository[]> {
  const route = 'GET /installation/repositories';
  return collectPages(route, pager(channel, route, headers), repositoryPageSchema);
}

export function fetchRepository(
  channel: Channel,
  headers: RequestHeaders,
  githubRepoId: GithubId,
): Promise<GitHubRepository | null> {
  const route = 'GET /repositories/{repository_id}';
  return readOrNullWhenForbidden(
    channel,
    route,
    () => channel.octokit.request(route, { repository_id: githubRepoId, headers }),
    repositorySchema,
  );
}

export function fetchMembership(
  channel: Channel,
  headers: RequestHeaders,
  org: string,
  login: string,
): Promise<GitHubOrgMembership | null> {
  const route = 'GET /orgs/{org}/memberships/{username}';
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { org, username: login, headers }),
    orgMembershipSchema,
  );
}

/** The route of the members probe (E14-S05), which also names it when there is no organisation to ask about. */
export const MEMBERS_ROUTE = 'GET /orgs/{org}/members';

/** Whether the App may list the members of `org` (E14-S05): true for a list, false for a refusal. One member is asked for, nothing is kept. */
export function fetchMembersPermission(channel: Channel, headers: RequestHeaders, org: string): Promise<boolean> {
  return answeredUnlessForbidden(
    channel,
    MEMBERS_ROUTE,
    () => channel.octokit.request(MEMBERS_ROUTE, { org, per_page: 1, headers }),
    membersProbeSchema,
  );
}

export function fetchRepositoryPermission(
  channel: Channel,
  headers: RequestHeaders,
  repository: { readonly owner: string; readonly repo: string },
  login: string,
): Promise<GitHubRepositoryPermission | null> {
  const route = 'GET /repos/{owner}/{repo}/collaborators/{username}/permission';
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { owner: repository.owner, repo: repository.repo, username: login, headers }),
    repositoryPermissionSchema,
  );
}
