// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import { GITHUB_ORG_LOGIN_PATTERN } from '../../../shared/corporate-approvals.ts';
import type { GitHubUserAccount } from '../../services/ports/github.ts';
import { type Channel, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { userAccountSchema } from './user-account-schema.ts';

// The two lookups of an account by login with an installation's token (E14-S06, E21-S03): `headers` carry the token, and a login that cannot
// name the account sends no request.

/**
 * The account `login` names (E14-S06), or null for a 404 and for a login that cannot be one, which sends no request. Octokit expands
 * `{username}` percent-encoded, so `dependabot[bot]` goes out as `dependabot%5Bbot%5D`.
 */
export function fetchUserAccount(
  channel: Channel,
  headers: RequestHeaders,
  login: string,
): Promise<GitHubUserAccount | null> {
  if (!ALLOWLIST_LOGIN_PATTERN.test(login)) {
    return Promise.resolve(null);
  }
  const route = 'GET /users/{username}';
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { username: login, headers }),
    userAccountSchema,
  );
}

/**
 * The organisation `login` names (E21-S03), or null for a 404 (a login of a person is a 404 here) and for a login that cannot be an
 * organisation's, which sends no request. The answer is read with the schema of an account: its id, its login and its type.
 */
export function fetchOrganizationAccount(
  channel: Channel,
  headers: RequestHeaders,
  login: string,
): Promise<GitHubUserAccount | null> {
  if (!GITHUB_ORG_LOGIN_PATTERN.test(login)) {
    return Promise.resolve(null);
  }
  const route = 'GET /orgs/{org}';
  return readOrNull(channel, route, () => channel.octokit.request(route, { org: login, headers }), userAccountSchema);
}
