// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderClaHtml, renderClaTree } from '../../shared/cla-markdown.ts';
import { sha256Hex } from './cla-content.ts';
import { readDraft } from './cla-drafts.ts';
import { publishVersion } from './cla-publish.ts';
import { draftWith, publication, publishWorld, versionsOf } from './publish-fixture/test-support.ts';

// The views of a CLA text are one (E12-S07): the editor preview renders the saved draft, the history view and the sign page render
// the published version, and when the version was published from that draft the two texts have equal bytes, so the two trees
// are equal. The hash stays over the source text: rendering changes nothing in the stored row.

const WORDING = [
  '# Sample document',
  '',
  'A paragraph with *emphasis*, a <placeholder> and a [link](https://example.org/terms).',
  '',
  '- one',
  '- two',
  '',
  '```',
  'a block of code',
  '```',
  '',
].join('\r\n');

/** The value, or a failure of the test when the row it looked for is not there. */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the row is missing');
  }
  return value;
}

test('the draft text and the published text of equal bytes are rendered to equal trees and equal HTML, and the hash is over the source', async () => {
  const world = await publishWorld();
  const revision = await draftWith(world, world.scoped, WORDING);
  const draft = required(await readDraft(world.db, world.scope, world.scoped));
  const published = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await publication(world, world.scoped, { source: { type: 'draft', revision } }),
  );
  const stored = required((await versionsOf(world.db, world.scoped)).find((row) => row.id === published.version.id));

  expect(draft.contentMd).toBe(stored.content_md);
  expect(renderClaTree(stored.content_md)).toStrictEqual(renderClaTree(draft.contentMd));
  expect(renderClaHtml(stored.content_md)).toBe(renderClaHtml(draft.contentMd));
  expect(renderClaHtml(stored.content_md)).toContain('&#x3C;placeholder>');
  expect(stored.content_sha256).toBe(sha256Hex(stored.content_md));
  expect(stored.content_sha256).not.toBe(sha256Hex(renderClaHtml(stored.content_md)));
});
