// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { OrgMembershipVerdict } from '../../../services/org-membership.ts';
import type { orgMembershipSchema } from '../schemas.ts';
import { START } from '../test-support.ts';

// The answers of `GET /orgs/{org}/memberships/{username}` the exemption lookup has to understand (E07-S10), as GitHub sends
// them: the adapter and the service are both run over each one, and each says what is expected of both. A 200 body is
// typed through the zod schema of the adapter, so a fixture that stops being something the schema reads fails the type
// check before it fails a test.

/** The person every fixture is about: the lookup handle GitHub resolves, and the numeric id that decides. */
export const ALICE = { login: 'alice', id: 77 } as const;

/**
 * A 200 body: what the schema reads (`z.input`), plus the fields GitHub sends that no schema keeps, which the adapter has
 * to drop.
 */
type MembershipBody = z.input<typeof orgMembershipSchema> & {
  readonly url: string;
  readonly organization_url: string;
  readonly user: { readonly login: string; readonly id: number };
};

/** The body of an error answer of GitHub's. */
interface ErrorBody {
  readonly message: string;
  readonly documentation_url: string;
}

/** What something produced: a value, or the error it rejected with, described as plain data so that `toEqual` compares it. */
export type Outcome<T> =
  | { readonly returned: T }
  | { readonly rejected: 'GitHubForbiddenError' }
  | { readonly rejected: 'GitHubRateLimitedError'; readonly retryAfterSeconds: number; readonly scope: string };

export interface MembershipFixture {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: MembershipBody | ErrorBody;
  /** What `getOrgMembership` of the adapter returns, or rejects with. */
  readonly adapter: Outcome<{ state: 'active' | 'pending'; role: string; userId: number } | null>;
  /** What `isOrgMember` answers for Alice (id 77) when GitHub sent this. */
  readonly service: Outcome<OrgMembershipVerdict>;
}

const DOCS = 'https://docs.github.com/rest/orgs/members#get-organization-membership-for-a-user';

/** A 200 for Alice's membership; `id` is the id GitHub says the login belongs to now. */
function membership(state: 'active' | 'pending', id: number): MembershipBody {
  return {
    url: 'https://api.github.com/orgs/acme/memberships/alice',
    state,
    role: 'member',
    organization_url: 'https://api.github.com/orgs/acme',
    user: { login: ALICE.login, id },
  };
}

const refusal = (message: string): ErrorBody => ({ message, documentation_url: DOCS });

/** The epoch second, in `x-ratelimit-reset`, that is `seconds` after the start of the fixtures' clock. */
const resetIn = (seconds: number): string => String(Date.parse(START) / 1000 + seconds);

/**
 * Alice is asked about, as member 77. The fixtures, by what GitHub answered:
 * - `active` and `pending`: her membership, in force or only invited;
 * - `idMismatch`: an active membership of the login, but of account 78, because 77 gave the login up and 78 took it;
 * - `notFound`: no membership (404 is an answer, not a failure);
 * - `permission`: a 403 that is no rate limit, the App lacks Members: read;
 * - `retryAfter` and `exhausted`: a 403 that is a rate limit, by `retry-after` and by `x-ratelimit-remaining: 0`.
 */
export const MEMBERSHIP_FIXTURES = {
  active: {
    status: 200,
    headers: {},
    body: membership('active', ALICE.id),
    adapter: { returned: { state: 'active', role: 'member', userId: ALICE.id } },
    service: { returned: 'member' },
  },
  pending: {
    status: 200,
    headers: {},
    body: membership('pending', ALICE.id),
    adapter: { returned: { state: 'pending', role: 'member', userId: ALICE.id } },
    service: { returned: 'not_member' },
  },
  idMismatch: {
    status: 200,
    headers: {},
    body: membership('active', 78),
    adapter: { returned: { state: 'active', role: 'member', userId: 78 } },
    service: { returned: 'not_member' },
  },
  notFound: {
    status: 404,
    headers: {},
    body: refusal('Not Found'),
    adapter: { returned: null },
    service: { returned: 'not_member' },
  },
  permission: {
    status: 403,
    headers: {},
    body: refusal('Resource not accessible by integration'),
    adapter: { rejected: 'GitHubForbiddenError' },
    service: { returned: 'permission_missing' },
  },
  retryAfter: {
    status: 403,
    headers: { 'retry-after': '120' },
    body: refusal('You have exceeded a secondary rate limit.'),
    adapter: { rejected: 'GitHubRateLimitedError', retryAfterSeconds: 120, scope: 'secondary' },
    service: { rejected: 'GitHubRateLimitedError', retryAfterSeconds: 120, scope: 'secondary' },
  },
  exhausted: {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': resetIn(600) },
    body: refusal('API rate limit exceeded for installation ID 11.'),
    adapter: { rejected: 'GitHubRateLimitedError', retryAfterSeconds: 600, scope: 'primary' },
    service: { rejected: 'GitHubRateLimitedError', retryAfterSeconds: 600, scope: 'primary' },
  },
} as const satisfies Record<string, MembershipFixture>;

/** The fixtures as `[name, fixture]`, for `test.each`. */
export const MEMBERSHIP_CASES: [name: string, fixture: MembershipFixture][] = Object.entries(MEMBERSHIP_FIXTURES);

/** The 200 fixtures, whose body the schema reads. */
export const MEMBERSHIP_BODIES: [name: string, body: MembershipBody][] = [
  ['active', MEMBERSHIP_FIXTURES.active.body],
  ['pending', MEMBERSHIP_FIXTURES.pending.body],
  ['idMismatch', MEMBERSHIP_FIXTURES.idMismatch.body],
];
