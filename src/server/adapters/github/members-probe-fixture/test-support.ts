// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import type { z } from 'zod';
import type { GithubId } from '../../../../shared/github-id.ts';
import type { MembersProbeAnswer } from '../../../services/fake-github/test-support.ts';
import type { GitHubInstallation } from '../../../services/ports/github.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import type { membersProbeSchema } from '../schemas.ts';

// The contract fixtures of `GET /orgs/{org}/members?per_page=1` (E14-S05): what GitHub answers to the members probe, as the
// HTTP boundary sees it, and what the adapter makes of each answer. The 200 bodies are typed through the zod schema the
// adapter reads them with, so a fixture the schema would refuse does not compile. They serve the adapter test with a mocked
// GitHub (`octokit-client-members-probe.test.ts`) and the HTTP world of the contract suite, which runs the same cases
// against `FakeGitHub` (`services/github-members-probe-contract`).

/** The fields of an answer the adapter reads, spelled as GitHub spells them. */
type MemberFields = z.input<typeof membersProbeSchema>[number];

/** The first member of an organisation as GitHub sends it: the fields the schema reads, and the ones the platform ignores. */
function memberBody(fields: MemberFields): Record<string, unknown> {
  return { login: `member-${fields.id}`, type: 'User', site_admin: false, node_id: 'MDQ6VXNlcjU=', ...fields };
}

/** An answer of GitHub: its status, headers and JSON body. */
interface MembersProbeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: object;
}

/** What the port does with an answer: resolves this, or rejects with the error of this name. */
export type ProbeOutcome = { readonly returns: boolean } | { readonly rejects: string };

export interface MembersProbeFixture {
  readonly response: MembersProbeResponse;
  readonly port: ProbeOutcome;
}

const reply = (status: number, body: object, headers: Record<string, string> = {}): MembersProbeResponse => ({
  status,
  headers,
  body,
});

/** The five answers a test of the contract can script (`MembersProbeAnswer`). */
export const MEMBERS_PROBE_ANSWERS: Readonly<Record<MembersProbeAnswer, MembersProbeFixture>> = {
  granted: { response: reply(200, [memberBody({ id: 501 })]), port: { returns: true } },
  missing: {
    response: reply(403, { message: 'Resource not accessible by integration' }),
    port: { returns: false },
  },
  rate_limited: {
    response: reply(
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'retry-after': '120' },
    ),
    port: { rejects: 'GitHubRateLimitedError' },
  },
  unavailable: { response: reply(500, { message: 'Server Error' }), port: { rejects: 'GitHubUnavailableError' } },
  malformed: { response: reply(200, { members: [] }), port: { rejects: 'GitHubResponseError' } },
};

/** The answers the contract does not script, for the adapter test: other ways of being a list, a refusal, a limit or a failure. */
const MORE_MEMBERS_PROBE_ANSWERS: readonly (readonly [name: string, fixture: MembersProbeFixture])[] = [
  ['an empty list', { response: reply(200, []), port: { returns: true } }],
  [
    'a list whose first member has no numeric id',
    { response: reply(200, [{ login: 'ghost' }]), port: { rejects: 'GitHubResponseError' } },
  ],
  [
    'a 403 worded as a secondary rate limit, with no header',
    {
      response: reply(403, { message: 'You have exceeded a secondary rate limit.' }),
      port: { rejects: 'GitHubRateLimitedError' },
    },
  ],
  [
    'a 403 with retry-after',
    {
      response: reply(403, { message: 'Forbidden' }, { 'retry-after': '90' }),
      port: { rejects: 'GitHubRateLimitedError' },
    },
  ],
  [
    'a 404, no such organisation',
    { response: reply(404, { message: 'Not Found' }), port: { rejects: 'GitHubNotFoundError' } },
  ],
  [
    'a 401, the token was refused twice',
    { response: reply(401, { message: 'Bad credentials' }), port: { rejects: 'GitHubAuthError' } },
  ],
];

/** The answers of both tables with the name each is shown under, for `test.each`. */
export const MEMBERS_PROBE_CASES: readonly (readonly [name: string, fixture: MembersProbeFixture])[] = [
  ...Object.entries(MEMBERS_PROBE_ANSWERS),
  ...MORE_MEMBERS_PROBE_ANSWERS,
];

/** What the mocked GitHub of the HTTP world needs to answer the probe. */
export interface MembersProbeRouteOptions {
  /** What each installation's probe answers; an installation absent here is granted. */
  readonly answers: ReadonlyMap<GithubId, MembersProbeAnswer>;
  /** The installation a request's token was minted for, or undefined for a token nobody holds. */
  readonly reached: (request: Request) => GitHubInstallation | undefined;
}

/**
 * `GET /orgs/{org}/members` as GitHub answers it to an installation token: a 401 for a token nobody holds, a 404 for an
 * organisation that is not the installation's own (a token sees its own organisation and no other), and for the
 * organisation itself the answer scripted for the installation.
 */
export function membersProbeRoute({ answers, reached }: MembersProbeRouteOptions) {
  return http.get(`${GITHUB_API_ORIGIN}/orgs/:org/members`, ({ request, params }) => {
    const installation = reached(request);
    if (installation === undefined) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
    }
    if (String(params['org']).toLowerCase() !== installation.account.login.toLowerCase()) {
      return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }
    const { status, headers, body } = MEMBERS_PROBE_ANSWERS[answers.get(installation.id) ?? 'granted'].response;
    return HttpResponse.json(body, { status, headers });
  });
}
