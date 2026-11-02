// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Octokit } from 'octokit';
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubOrgMembership, GitHubRepository } from '../../services/ports/github.ts';
import { pager, type RequestHeaders, readOrNull, readOrNullWhenForbidden } from './octokit-request.ts';
import { collectPages } from './pagination.ts';
import { orgMembershipSchema, repositoryPageSchema, repositorySchema } from './schemas.ts';

// The requests the GitHub client port makes with an installation's token (E05-S04): `headers` carry the token. Route
// templates name a route in errors and are what Octokit expands.

export function fetchRepositories(octokit: Octokit, headers: RequestHeaders): Promise<GitHubRepository[]> {
  const route = 'GET /installation/repositories';
  return collectPages(route, pager(octokit, route, headers), repositoryPageSchema);
}

export function fetchRepository(
  octokit: Octokit,
  headers: RequestHeaders,
  githubRepoId: GithubId,
): Promise<GitHubRepository | null> {
  const route = 'GET /repositories/{repository_id}';
  return readOrNullWhenForbidden(
    route,
    () => octokit.request(route, { repository_id: githubRepoId, headers }),
    repositorySchema,
  );
}

export function fetchMembership(
  octokit: Octokit,
  headers: RequestHeaders,
  org: string,
  login: string,
): Promise<GitHubOrgMembership | null> {
  const route = 'GET /orgs/{org}/memberships/{username}';
  return readOrNull(route, () => octokit.request(route, { org, username: login, headers }), orgMembershipSchema);
}
