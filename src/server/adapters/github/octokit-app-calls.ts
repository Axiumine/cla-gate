// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Octokit } from 'octokit';
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubAppInfo, GitHubInstallation } from '../../services/ports/github.ts';
import { pager, parseOne, type RequestHeaders, readOrNull, send } from './octokit-request.ts';
import { collectPages } from './pagination.ts';
import { appSchema, installationPageSchema, installationSchema } from './schemas.ts';

// The requests the GitHub client port makes as the App (E05-S04): `headers` carry the App JWT. Route templates name a
// route in errors and are what Octokit expands.

export async function fetchApp(octokit: Octokit, headers: RequestHeaders): Promise<GitHubAppInfo> {
  const route = 'GET /app';
  const page = await send(route, () => octokit.request(route, { headers }));
  return parseOne(route, appSchema, page.data);
}

export function fetchInstallation(
  octokit: Octokit,
  headers: RequestHeaders,
  githubInstallationId: GithubId,
): Promise<GitHubInstallation | null> {
  const route = 'GET /app/installations/{installation_id}';
  return readOrNull(
    route,
    () => octokit.request(route, { installation_id: githubInstallationId, headers }),
    installationSchema,
  );
}

export function fetchInstallations(octokit: Octokit, headers: RequestHeaders): Promise<GitHubInstallation[]> {
  const route = 'GET /app/installations';
  return collectPages(route, pager(octokit, route, headers), installationPageSchema);
}
