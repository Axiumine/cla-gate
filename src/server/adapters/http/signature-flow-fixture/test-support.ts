// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGN_PATH } from '../../../../shared/sign.ts';
import type { flowWorld } from '../repository-flow-fixture/test-support.ts';

// The two helpers of the flow tests that take a signature out of force and bring it back (E15-S03 revocation, E15-S04 invalidation), on
// the flow world of tenant 1: its comment on a pull request, and its signer signing again.

type FlowWorld = Awaited<ReturnType<typeof flowWorld>>;

const FULL_NAME = 'org-1/repo';

/** The comment text of the pull request `prNumber`, all comments joined; empty when there is none. */
export async function commentsOf(world: FlowWorld, prNumber: number): Promise<string> {
  const page = await world.github.client.listIssueComments(world.t1.githubInstallationId, FULL_NAME, prNumber, 1);
  return page.comments.map((comment) => comment.body).join('\n');
}

/** The signer signs again, as the sign page does: a session with a verified address, the app's origin, the token and the body of tenant 1's repository. */
export async function signAgain(world: FlowWorld, prNumber: number) {
  const { t1, people } = world;
  const session = await world.login(people.member1.githubId);
  await world.db
    .updateTable('sessions')
    .set({ verified_emails: JSON.stringify([{ email: 'member@example.org', primary: true }]) })
    .where('id', '=', session.sessionId)
    .execute();
  return world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { ...session.headers, 'content-type': 'application/json' },
    payload: JSON.stringify({
      githubRepoId: t1.plain.githubRepoId,
      prNumber,
      versionId: t1.versionId,
      contentSha256: t1.contentSha256,
      consentTextId: 'individual-v1',
      name: 'Member One',
      email: 'member@example.org',
    }),
  });
}
