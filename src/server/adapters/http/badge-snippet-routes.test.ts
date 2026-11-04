// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { badgeSnippet } from '../../domain/badge-snippet.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import {
  optedIn,
  optInAs,
  optInWorld,
  ownDocumentOnScoped,
  snippetAs,
  snippetAt,
  snippetOf,
} from './repository-public-verification-fixture/test-support.ts';

// GET /api/installations/:installationId/repositories/:repositoryId/badge-snippet (E22-S03): who may read the snippet of the README badge, what it
// holds, and when it is refused. The other tenant's ids are in badge-snippet-routes-tenants.test.ts.

test('the org admin reads the snippet of a repository that opted in: Markdown and HTML of the project badge, linked to the sign page, built on PUBLIC_BASE_URL', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optedIn(world, t1.plain.repositoryId);
  const response = await snippetAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect(snippetOf(response)).toEqual(badgeSnippet(world.origin, t1.plain.githubRepoId));
  const { markdown, html } = snippetOf(response);
  expect(markdown).toBe(
    `[![CLA: required](${world.origin}/api/public/repos/${t1.plain.githubRepoId}/badge.svg)](${world.origin}/sign/${t1.plain.githubRepoId})`,
  );
  expect(html).toBe(
    `<a href="${world.origin}/sign/${t1.plain.githubRepoId}"><img src="${world.origin}/api/public/repos/${t1.plain.githubRepoId}/badge.svg" alt="CLA: required"></a>`,
  );
});

test('the snippet names the repository by its GitHub id and holds no name, no login, no installation id and no row id of ours', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optedIn(world, t1.plain.repositoryId);
  const { markdown, html } = snippetOf(await snippetAs(world, 'admin1', t1.plain.repositoryId));
  for (const text of [markdown, html]) {
    expect(text).toContain(String(t1.plain.githubRepoId));
    expect(text).not.toContain('org-1');
    expect(text).not.toContain('octocat');
    expect(text).not.toContain('/installations/');
  }
});

test('the answer is for one maintainer and kept by no cache, and the call sends no request to GitHub and changes no row', async () => {
  const world = await optInWorld();
  await optedIn(world, world.t1.plain.repositoryId);
  const before = await tablesOf(world);
  const response = await snippetAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  expect(world.fakeGitHub.calls).toEqual([]);
  expect(await tablesOf(world)).toEqual(before);
});

test('while the opt-in is off the snippet is 409 public_verification_disabled, and the opt-in call turns it on and off again', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  const off = await snippetAs(world, 'admin1', t1.plain.repositoryId);
  expect([off.statusCode, errorCodeOf(off)]).toEqual([409, 'public_verification_disabled']);
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect((await snippetAs(world, 'admin1', t1.plain.repositoryId)).statusCode).toBe(200);
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: false });
  const again = await snippetAs(world, 'admin1', t1.plain.repositoryId);
  expect([again.statusCode, errorCodeOf(again)]).toEqual([409, 'public_verification_disabled']);
});

test('the snippet does not depend on enforcement: the badge is a 404 until the repository enforces, but the maintainers may paste the snippet first', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optedIn(world, t1.plain.repositoryId);
  const enabled = await world.db
    .selectFrom('repositories')
    .select('enabled')
    .where('id', '=', t1.plain.repositoryId)
    .executeTakeFirstOrThrow();
  expect(enabled.enabled).toBe(false);
  expect((await snippetAs(world, 'admin1', t1.plain.repositoryId)).statusCode).toBe(200);
});

test('the admin of a repository whose own CLA is attached reads the snippet of that repository, and so does the org admin', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await ownDocumentOnScoped(world);
  await optedIn(world, t1.scoped.repositoryId);
  const byRepoAdmin = await snippetAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  const byOrgAdmin = await snippetAs(world, 'admin1', t1.scoped.repositoryId);
  expect([byRepoAdmin.statusCode, byOrgAdmin.statusCode]).toEqual([200, 200]);
  expect(snippetOf(byRepoAdmin)).toEqual(snippetOf(byOrgAdmin));
});

test('the admin of a repository is 403 forbidden for a repository whose document covers the installation or is none, whatever the opt-in is: the role is judged first', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  for (const on of [false, true]) {
    await optedIn(world, t1.plain.repositoryId, on);
    await optedIn(world, t1.scoped.repositoryId, on);
    const another = await snippetAs(world, 'repoAdmin1', t1.plain.repositoryId);
    const noDocument = await snippetAs(world, 'repoAdmin1', t1.scoped.repositoryId);
    expect([another.statusCode, errorCodeOf(another)]).toEqual([403, 'forbidden']);
    expect([noDocument.statusCode, errorCodeOf(noDocument)]).toEqual([403, 'forbidden']);
  }
});

test('a person with no role in the installation gets the 404 of an unknown repository, byte for byte, with the opt-in on or off', async () => {
  const world = await optInWorld();
  const unknown = await snippetAs(world, 'admin1', 987_654);
  for (const on of [false, true]) {
    await optedIn(world, world.t1.plain.repositoryId, on);
    const answers = [
      await snippetAs(world, 'member1', world.t1.plain.repositoryId),
      await snippetAs(world, 'outsider', world.t1.plain.repositoryId),
      await snippetAs(world, 'admin2', world.t1.plain.repositoryId),
    ];
    expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
    expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  }
});

test('a person with no session gets 401', async () => {
  const world = await optInWorld();
  await optedIn(world, world.t1.plain.repositoryId);
  const response = await snippetAs(world, null, world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([401, 'unauthorized']);
});

test('ids that are not ids are 400 before anything is read, and an unknown or removed repository is 404', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optedIn(world, t1.plain.repositoryId);
  const garbage = await snippetAs(world, 'admin1', '0x10');
  const badInstallation = await snippetAt(world, 'admin1', {
    installationId: 'abc',
    repositoryId: t1.plain.repositoryId,
  });
  const unknown = await snippetAs(world, 'admin1', 987_654);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: world.clock.now() })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const removed = await snippetAs(world, 'admin1', t1.plain.repositoryId);
  expect([garbage.statusCode, badInstallation.statusCode, unknown.statusCode, removed.statusCode]).toEqual([
    400, 400, 404, 404,
  ]);
});

test('a suspended installation still shows the snippet to the org admin it remembers: a read, not a change', async () => {
  const world = await optInWorld();
  await optedIn(world, world.t1.plain.repositoryId);
  await suspendTenantOne(world);
  const response = await snippetAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  const stranger = await snippetAs(world, 'member1', world.t1.plain.repositoryId);
  expect(stranger.statusCode).toBe(404);
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s on the snippet is not a route', async (method) => {
  const world = await optInWorld();
  const response = await world.ask('admin1', {
    method,
    url: `/api/installations/${world.t1.installationId}/repositories/${world.t1.plain.repositoryId}/badge-snippet`,
    payload: {},
  });
  expect(response.statusCode).toBe(404);
});
