// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { expect, onTestFinished } from 'vitest';

// The public-members endpoints are not used to decide who is exempt (E07-S10). `GET /orgs/{org}/public_members/{username}` answers for the
// people who chose to show their membership, so it says "not a member" for a member who did not: a verdict taken from it would deny exempt
// people. The one use is the claim under a corporate agreement (E21-S04), where a person asks to be covered through a `github_org` rule
// and a "no" only means "ask the employer's CLA manager"; it is served by the contract worlds and by the test of that check, which answer
// it before this handler. Every mocked GitHub of the adapter tests carries this handler, so any other request to one of the endpoints is
// answered with a network error and, whatever the code under test does with that, fails the test when it ends.

/** The path of both endpoints: the list and the check of one person. */
const PUBLIC_MEMBERS = /\/orgs\/[^/]+\/public_members(?:\/|$)/;

/** The handler of the public-members endpoints, and the requests it has seen. */
export class PublicMembersGuard {
  /** `METHOD /path` of every request that reached an endpoint, in order. */
  readonly hits: string[] = [];

  readonly handler = http.all(PUBLIC_MEMBERS, ({ request }) => {
    this.hits.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.error();
  });

  /** @throws Error (a failed expectation) when a request has reached a public-members endpoint. */
  assertUnused(): void {
    expect(this.hits, 'the public-members endpoints are never used').toEqual([]);
  }
}

/** A guard whose check runs when the test ends, passed or not: serve its `handler` next to the routes of the test. */
export function guardPublicMembers(): PublicMembersGuard {
  const guard = new PublicMembersGuard();
  onTestFinished(() => {
    guard.assertUnused();
  });
  return guard;
}
