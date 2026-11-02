// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubOrgMembership, GitHubRepository } from '../../services/ports/github.ts';
import { type Channel, pager, type RequestHeaders, readOrNull, readOrNullWhenForbidden } from './octokit-request.ts';
import { collectPages } from './pagination.ts';
import { orgMembershipSchema, repositoryPageSchema, repositorySchema } from './schemas.ts';

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
