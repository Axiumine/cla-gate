// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { badgeSnippet } from '../../domain/badge-snippet.ts';
import { errorCodeOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  optedIn,
  optInAs,
  optInWorld,
  snippetAs,
  snippetAt,
  snippetOf,
} from './repository-public-verification-fixture/test-support.ts';

// The other tenant's ids and the link between the snippet and the public badge of GET .../repositories/:repositoryId/badge-snippet (E22-S03). The
// roles and the refusals are in badge-snippet-routes.test.ts.

test("the other tenant's repository id is 404 for either org admin, the answer for an id that exists nowhere, with the opt-in on or off", async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  const unknown = await snippetAs(world, 'admin1', 987_654);
  for (const on of [false, true]) {
    for (const repositoryId of [t1.plain.repositoryId, t2.plain.repositoryId, t2.scoped.repositoryId]) {
      await optedIn(world, repositoryId, on);
    }
    const answers = [
      await snippetAs(world, 'admin1', t2.plain.repositoryId),
      await snippetAs(world, 'admin1', t2.scoped.repositoryId),
      await snippetAt(world, 'admin2', { installationId: t2.installationId, repositoryId: t1.plain.repositoryId }),
      await snippetAt(world, 'admin2', { installationId: t2.installationId, repositoryId: t1.scoped.repositoryId }),
    ];
    expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
    expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  }
});

test("an installation id of one tenant with the repository of the other is 404 for the admin of either, and never shows the other tenant's GitHub repository id", async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  await optedIn(world, t1.plain.repositoryId);
  await optedIn(world, t2.plain.repositoryId);
  const crossed = [
    await snippetAt(world, 'admin1', { installationId: t1.installationId, repositoryId: t2.plain.repositoryId }),
    await snippetAt(world, 'admin1', { installationId: t2.installationId, repositoryId: t1.plain.repositoryId }),
    await snippetAt(world, 'admin2', { installationId: t2.installationId, repositoryId: t1.plain.repositoryId }),
    await snippetAt(world, 'admin2', { installationId: t1.installationId, repositoryId: t2.plain.repositoryId }),
  ];
  expect(crossed.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual(Array(4).fill([404, 'not_found']));
  for (const answer of crossed) {
    expect(answer.body).not.toContain(String(t2.plain.githubRepoId));
  }
});

test("each org admin reads the snippet of their own tenant's repository, and the two snippets name two repositories", async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  await optedIn(world, t1.plain.repositoryId);
  await optedIn(world, t2.plain.repositoryId);
  const first = await snippetAs(world, 'admin1', t1.plain.repositoryId);
  const second = await snippetAt(world, 'admin2', {
    installationId: t2.installationId,
    repositoryId: t2.plain.repositoryId,
  });
  expect(snippetOf(first)).toEqual(badgeSnippet(world.origin, t1.plain.githubRepoId));
  expect(snippetOf(second)).toEqual(badgeSnippet(world.origin, t2.plain.githubRepoId));
  expect(snippetOf(first)).not.toEqual(snippetOf(second));
});

test('the opt-in of one tenant does not turn on the snippet of the other', async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect((await snippetAs(world, 'admin1', t1.plain.repositoryId)).statusCode).toBe(200);
  const other = await snippetAt(world, 'admin2', {
    installationId: t2.installationId,
    repositoryId: t2.plain.repositoryId,
  });
  expect([other.statusCode, errorCodeOf(other)]).toEqual([409, 'public_verification_disabled']);
});

test('the snippet points at a badge that is there: the repository it names answers the project badge once it enforces', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optedIn(world, t1.plain.repositoryId);
  await world.db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: t1.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const { markdown } = snippetOf(await snippetAs(world, 'admin1', t1.plain.repositoryId));
  const image = markdown.slice(markdown.indexOf('](') + 2, markdown.indexOf(')'));
  expect(image.startsWith(world.origin)).toBe(true);
  const badge = await world.app.inject({ method: 'GET', url: image.slice(world.origin.length) });
  expect([badge.statusCode, badge.headers['content-type']]).toEqual([200, 'image/svg+xml; charset=utf-8']);
});
