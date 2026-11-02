// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubAppInfo, GitHubInstallation } from '../../services/ports/github.ts';
import { type Channel, pager, parseOne, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { collectPages } from './pagination.ts';
import { appSchema, installationPageSchema, installationSchema } from './schemas.ts';

// The requests the GitHub client port makes as the App (E05-S04): `headers` carry the App JWT. Route templates name a
// route in errors and are what Octokit expands. `channel` is the App's lane in the rate limiter (E05-S05).

export async function fetchApp(channel: Channel, headers: RequestHeaders): Promise<GitHubAppInfo> {
  const route = 'GET /app';
  const page = await channel.send(route, () => channel.octokit.request(route, { headers }));
  return parseOne(route, appSchema, page.data);
}

export function fetchInstallation(
  channel: Channel,
  headers: RequestHeaders,
  githubInstallationId: GithubId,
): Promise<GitHubInstallation | null> {
  const route = 'GET /app/installations/{installation_id}';
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { installation_id: githubInstallationId, headers }),
    installationSchema,
  );
}

export function fetchInstallations(channel: Channel, headers: RequestHeaders): Promise<GitHubInstallation[]> {
  const route = 'GET /app/installations';
  return collectPages(route, pager(channel, route, headers), installationPageSchema);
}
