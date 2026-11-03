// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  type ClientFixtureOptions,
  clientFixture,
  json,
  type RouteAnswer,
  type Routes,
} from '../../../adapters/github/client-fixture/test-support.ts';
import { HEAD, reportingWorld } from '../test-support.ts';

// A GitHub that answers the Check Run routes as a test scripts them (E09-S06), behind the real Octokit adapter, so that the
// failures the reporter must tell apart arrive as the statuses GitHub sends. Every route has a plain answer a test replaces.

export const LISTING = 'GET /repos/:owner/:repo/commits/:sha/check-runs';
export const POST = 'POST /repos/:owner/:repo/check-runs';
const GET_RUN = 'GET /repos/:owner/:repo/check-runs/:id';
export const PATCH = 'PATCH /repos/:owner/:repo/check-runs/:id';

/** Text that must never come back out of the reporter: it is in the body of every failure below. */
const LEAK = 'LEAKED-BODY-TEXT ghs_leaked_token';

/** The run GitHub answers with: ours (App 4242), on the head SHA of the tests. */
export const RUN = {
  id: 9_000_001,
  head_sha: HEAD,
  name: 'license/cla',
  status: 'in_progress',
  external_id: '1',
  app: { id: 4242 },
};

const emptyListing: RouteAnswer = () => json({ total_count: 0, check_runs: [] });
export const created: RouteAnswer = () => json(RUN, 201);
const found: RouteAnswer = () => json(RUN);
export const updated: RouteAnswer = () => json({ ...RUN, status: 'completed' });

/** A failure answer with a body that must not leak. */
export const refused =
  (status: number, headers: Record<string, string> = {}): RouteAnswer =>
  () =>
    json({ message: LEAK }, status, headers);

/** Answers with `answers` in turn; the last one answers every request after them. */
export function inOrder(first: RouteAnswer, ...later: RouteAnswer[]): RouteAnswer {
  let current = first;
  return (call) => {
    const answer = current;
    current = later.shift() ?? current;
    return answer(call);
  };
}

/** The reporter on the adapter over MSW: the listing is empty and the routes of the Check Run answer as `routes` say. */
export async function scripted(routes: Routes, options: ClientFixtureOptions = {}) {
  const fixture = clientFixture(
    { [LISTING]: emptyListing, [POST]: created, [GET_RUN]: found, [PATCH]: updated, ...routes },
    options,
  );
  const world = await reportingWorld({ github: fixture.client });
  return { world, ...fixture };
}
