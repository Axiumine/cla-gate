// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import type { GitHubOrgMembership } from '../../../services/ports/github.ts';
import { GitHubForbiddenError, GitHubRateLimitedError } from '../../../services/ports/github-errors.ts';
import { VIEWER_ID } from '../../../services/role-fixture/test-support.ts';
import { json, type RouteAnswer } from '../client-fixture/test-support.ts';
import type { orgMembershipSchema } from '../schemas.ts';

// The contract fixtures of `GET /orgs/{org}/memberships/{username}` (E11-S02, shared with the exemption lookup of
// E07-S10): what GitHub answers to the one membership call, as the HTTP boundary sees it, with what the adapter makes of
// each answer and what the org admin lookup makes of that, for the viewer of the role tests (numeric id 501, login
// `alice`, organisation `acme`). The bodies are typed through the zod schema the adapter reads them with, so a fixture
// that the schema would refuse does not compile.

/** The fields of an answer the adapter reads, spelled as GitHub spells them. */
type MembershipFields = z.input<typeof orgMembershipSchema>;

/** A membership answer as GitHub sends it: the fields the schema reads, and the ones the platform ignores. */
function membershipBody(fields: MembershipFields): Record<string, unknown> {
  return {
    url: 'https://api.github.com/orgs/acme/memberships/alice',
    organization_url: 'https://api.github.com/orgs/acme',
    ...fields,
    user: { login: 'alice', site_admin: false, ...fields.user },
  };
}

/** What the GitHub client port does with an answer: returns this (null for "no such membership"), or throws this. */
type PortOutcome =
  | { readonly returns: GitHubOrgMembership | null }
  | { readonly throws: typeof GitHubForbiddenError | typeof GitHubRateLimitedError };

/** What the org admin lookup does with an answer: resolves whether the viewer is an admin, or throws the rate limit. */
type LookupOutcome =
  | { readonly admin: boolean; readonly permissionMissing: boolean }
  | { readonly limitedForSeconds: number };

export interface MembershipFixture {
  readonly name: string;
  readonly answer: RouteAnswer;
  readonly port: PortOutcome;
  readonly lookup: LookupOutcome;
}

/** The numeric id GitHub gives to whoever holds the login `alice` now, after the viewer's account gave it up. */
const NEW_HOLDER_ID: GithubId = parseGithubId(VIEWER_ID + 1);

const membership = (
  state: GitHubOrgMembership['state'],
  role: GitHubOrgMembership['role'],
  userId: GithubId,
): GitHubOrgMembership => ({ state, role, userId });

const notAdmin: LookupOutcome = { admin: false, permissionMissing: false };

export const MEMBERSHIP_FIXTURES: readonly MembershipFixture[] = [
  {
    name: 'an active admin',
    answer: () => json(membershipBody({ state: 'active', role: 'admin', user: { id: VIEWER_ID } })),
    port: { returns: membership('active', 'admin', VIEWER_ID) },
    lookup: { admin: true, permissionMissing: false },
  },
  {
    name: 'an active member',
    answer: () => json(membershipBody({ state: 'active', role: 'member', user: { id: VIEWER_ID } })),
    port: { returns: membership('active', 'member', VIEWER_ID) },
    lookup: notAdmin,
  },
  {
    name: 'an active billing manager',
    answer: () => json(membershipBody({ state: 'active', role: 'billing_manager', user: { id: VIEWER_ID } })),
    port: { returns: membership('active', 'billing_manager', VIEWER_ID) },
    lookup: notAdmin,
  },
  {
    name: 'a pending invitation to be admin',
    answer: () => json(membershipBody({ state: 'pending', role: 'admin', user: { id: VIEWER_ID } })),
    port: { returns: membership('pending', 'admin', VIEWER_ID) },
    lookup: notAdmin,
  },
  {
    name: 'a 404, no such membership',
    answer: () => json({ message: 'Not Found' }, 404),
    port: { returns: null },
    lookup: notAdmin,
  },
  {
    name: 'a 403, the Members: read permission is missing',
    answer: () => json({ message: 'Resource not accessible by integration' }, 403),
    port: { throws: GitHubForbiddenError },
    lookup: { admin: false, permissionMissing: true },
  },
  {
    name: 'a 403 that is a rate limit, the budget is used up',
    answer: () =>
      json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }),
    port: { throws: GitHubRateLimitedError },
    lookup: { limitedForSeconds: 120 },
  },
  {
    name: 'an id mismatch, the login now belongs to someone else',
    answer: () => json(membershipBody({ state: 'active', role: 'admin', user: { id: NEW_HOLDER_ID } })),
    port: { returns: membership('active', 'admin', NEW_HOLDER_ID) },
    lookup: notAdmin,
  },
];
