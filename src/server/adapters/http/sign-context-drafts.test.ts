// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { contextOf, errorCodeOf, repoIdOf, signWorld } from './sign-context-fixture/test-support.ts';

// A draft is the work in progress of the admins of a scope and no contributor-facing route shows it (E12-S03). The sign page
// context is the first of those routes: for a repository whose document has a draft, the answer holds the text of the published
// version and no word of the draft. The sweep of every route of the application is in document-draft-surface.test.ts.

const MARKER = 'DRAFT-ONLY-WORDING-5c2e84';

/** Stores a draft of tenant 1's document, as an admin's save would. */
async function saveDraft(world: Awaited<ReturnType<typeof signWorld>>, text: string): Promise<void> {
  await world.db
    .insertInto('cla_drafts')
    .values({
      document_id: world.t1.documentId,
      installation_id: world.t1.installationId,
      content_md: text,
      updated_by: world.t1.publisherId,
    })
    .execute();
}

test("the sign context of a repository whose document has a draft holds the published text and none of the draft's", async () => {
  const world = await signWorld();
  await saveDraft(world, `${MARKER} wording that is not published yet\n`);
  const ada = await world.login(1234);
  const response = await world.ask(ada, repoIdOf(1), '?pr=7');
  expect(response.body).not.toContain(MARKER);
  expect(contextOf(response).version.contentMd).toBe('I grant the project a perpetual licence to my contributions.');
});

test('a document with a draft and no published version is a 409 no_active_cla, and the answer holds no word of the draft', async () => {
  const world = await signWorld();
  await saveDraft(world, `${MARKER} wording that is not published yet\n`);
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: null })
    .where('id', '=', world.t1.documentId)
    .execute();
  const response = await world.ask(await world.login(1234), repoIdOf(1));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'no_active_cla']);
  expect(response.body).not.toContain(MARKER);
});

test('the log lines of the request hold no word of the draft either', async () => {
  const world = await signWorld();
  await saveDraft(world, `${MARKER} wording that is not published yet\n`);
  await world.ask(await world.login(1234), repoIdOf(1));
  expect(world.logs.text()).not.toContain(MARKER);
});
