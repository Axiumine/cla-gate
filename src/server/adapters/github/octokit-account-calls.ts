// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import { GITHUB_ORG_LOGIN_PATTERN } from '../../../shared/corporate-approvals.ts';
import type { GitHubUserAccount } from '../../services/ports/github.ts';
import { answeredOrNotFound, type Channel, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { userAccountSchema } from './user-account-schema.ts';

// The lookups of an account by login with an installation's token (E14-S06, E21-S03) and the check of a public membership (E21-S04): `headers` carry
// the token, and a login that cannot name the account sends no request.

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

/**
 * Whether `login` shows a membership of `org` (E21-S04): true for a 204, false for a 404 and for names that cannot be logins, which sends no
 * request. Octokit expands the two names percent-encoded.
 */
export function fetchPublicMembership(
  channel: Channel,
  headers: RequestHeaders,
  member: { readonly org: string; readonly login: string },
): Promise<boolean> {
  if (!GITHUB_ORG_LOGIN_PATTERN.test(member.org) || !ALLOWLIST_LOGIN_PATTERN.test(member.login)) {
    return Promise.resolve(false);
  }
  const route = 'GET /orgs/{org}/public_members/{username}';
  // GitHub answers a 204 without a body to a member and a 404 to anyone else; the status is what is read, so any other success is refused.
  const request = async () => {
    const { status, headers: answered } = await channel.octokit.request(route, {
      org: member.org,
      username: member.login,
      headers,
    });
    return { data: status, headers: answered };
  };
  return answeredOrNotFound(channel, route, request, z.literal(204));
}
