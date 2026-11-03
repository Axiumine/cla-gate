// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersionResponseSchema } from '../../../shared/cla-version.ts';
import { realPostgresOnly } from '../db/test-support.ts';
import {
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  publishAs,
  saveDraftAs,
} from './document-fixture/test-support.ts';

// Simultaneous publishes of one document (E12-S04), over HTTP, on a real server: they all name the same active version, and
// exactly one is a 201 while every other is a 409 stale_active_version, with no gap and no duplicate in the numbers. PGlite has
// one connection, so its requests are served one after the other and cannot race; the sequential case here gives the same
// outcome on whatever engine runs the suite. The statement level of the race, with the order decided by a lock and not by luck,
// is in cla-publish-concurrency.test.ts.

const target = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

/** Creates the draft of the document the tests publish: the seeded one is published first and every publish deletes the draft, so the later ones are new. */
async function draftFor(world: DocumentWorld, round: number): Promise<void> {
  const saved = await saveDraftAs(world, 'admin1', target(world), {
    contentMd: `Text of round ${round}\n`,
    expectedRevision: null,
  });
  expect(saved.statusCode, `draft of round ${round}`).toBe(200);
}

/** The version the one 201 among the answers of a round published. */
function publishedIn(answers: readonly Awaited<ReturnType<typeof publishAs>>[]) {
  const created = answers.filter((answer) => answer.statusCode === 201);
  const [only] = created;
  if (created.length !== 1 || only === undefined) {
    throw new Error(`expected one 201 among ${answers.length} answers, got ${created.length}`);
  }
  return parsed(only, publishVersionResponseSchema).version;
}

const publication = (activeVersionId: number | null) => ({
  source: { type: 'draft', revision: 1 },
  bump: 'major',
  rationale: 'A race',
  expectedActiveVersionId: activeVersionId,
});

test('two publishes naming one active version, one after the other, give a 201 and a 409 stale_active_version with the new one, on whatever engine runs the suite', async () => {
  const world = await documentWorld();
  const won = await publishAs(world, 'admin1', target(world), publication(null));
  const lost = await publishAs(world, 'repoAdmin1', target(world), publication(null));
  expect([won.statusCode, lost.statusCode]).toEqual([201, 409]);
  const { version } = parsed(won, publishVersionResponseSchema);
  expect(lost.json<{ error: { code: string; details: unknown } }>().error).toMatchObject({
    code: 'stale_active_version',
    details: { activeVersionId: version.id },
  });
});

realPostgresOnly(
  'five simultaneous publishes naming one active version give exactly one 201 and four 409 stale_active_version, every round, with no gap or duplicate',
  async () => {
    const world = await documentWorld();
    const { installationId, documentId } = target(world);
    const people = ['admin1', 'repoAdmin1', 'admin1', 'repoAdmin1', 'admin1'] as const;
    let active: number | null = null;
    for (let round = 1; round <= 4; round++) {
      if (round > 1) {
        await draftFor(world, round);
      }
      const answers = await Promise.all(
        people.map((who) => publishAs(world, who, { installationId, documentId }, publication(active))),
      );
      const statuses = answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b);
      expect(statuses, `round ${round}`).toEqual([201, 409, 409, 409, 409]);
      const winner = publishedIn(answers);
      expect(winner, `round ${round}`).toMatchObject({ major: round, minor: 0 });
      for (const loser of answers.filter((answer) => answer.statusCode === 409)) {
        expect(errorCodeOf(loser), `round ${round}`).toBe('stale_active_version');
        expect(loser.json<{ error: { details: unknown } }>().error.details, `round ${round}`).toEqual({
          activeVersionId: winner.id,
        });
      }
      active = winner.id;
    }
    const numbers = await world.db
      .selectFrom('cla_versions')
      .select(['major', 'minor'])
      .where('document_id', '=', documentId)
      .orderBy('major')
      .orderBy('minor')
      .execute();
    expect(numbers).toEqual([1, 2, 3, 4].map((major) => ({ major, minor: 0 })));
    const audited = await world.db
      .selectFrom('audit_log')
      .select('metadata')
      .where('action', '=', 'cla_version.published')
      .orderBy('id')
      .execute();
    expect(audited).toHaveLength(4);
    const pointer = await world.db
      .selectFrom('cla_documents')
      .select('active_version_id')
      .where('id', '=', documentId)
      .executeTakeFirstOrThrow();
    expect(pointer.active_version_id).toBe(active);
  },
);
