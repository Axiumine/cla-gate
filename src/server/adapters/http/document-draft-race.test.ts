// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, inject, test } from 'vitest';
import { AUTH_ENV, TEST_SESSION_SECRET } from '../../config/auth-fixture/test-support.ts';
import { StubRoleLookup } from '../../services/role-table-fixture/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { testApp, testConfig } from '../../test-support.ts';
import { createSessionStore } from '../db/sessions.ts';
import { twoTenants } from '../db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, openTestDatabase, realPostgresOnly } from '../db/test-support.ts';
import { COOKIE_NAME, expectedToken } from './auth-fixture/test-support.ts';
import { draftPath } from './document-fixture/test-support.ts';

// Two simultaneous saves of one draft (E12-S03), over HTTP, on a real server: both name the same revision, and exactly one
// is a 200 while the other is a 409 draft_conflict. PGlite has one connection, so its requests are served one after the other
// and cannot race; the sequential cases are in document-draft-routes-save.test.ts and give the same outcome. The statement
// level of the race, with the order decided by a lock and not by luck, is in cla-drafts-concurrency.test.ts.

const T0 = '2026-11-02T10:00:00.000Z';

/** The app on its own pool of the throw-away database, two tenants and two logged-in admins of tenant 1. */
async function raceWorld() {
  const roles = new StubRoleLookup();
  const { db } = await migratedTestDatabase();
  const seeded = await twoTenants(db, roles);
  const clock = new FakeClock(T0);
  const url = inject('testDatabaseUrl');
  // On PGlite there is one database and the app uses it; on Postgres the app has a pool of its own, so saves overlap.
  const appDb = url === undefined ? db : (await openTestDatabase(url)).db;
  const { app } = await testApp({ env: AUTH_ENV, db: appDb, clock, github: roles });
  const config = testConfig(AUTH_ENV);
  const store = createSessionStore(db, config.session);
  const origin = new URL(config.publicBaseUrl).origin;
  const login = async (userId: number) => {
    const created = await store.create({ userId }, clock.now());
    const cookie = `${COOKIE_NAME}=${created.id}`;
    return { cookie, origin, 'x-csrf-token': expectedToken(TEST_SESSION_SECRET, created.csrfSecret) };
  };
  const admin = await login(seeded.people.admin1.userId);
  const repoAdmin = await login(seeded.people.repoAdmin1.userId);
  const save = (who: string, headers: typeof admin, expectedRevision: number | null) =>
    app.inject({
      method: 'PUT',
      url: draftPath(seeded.t1.installationId, seeded.t1.scoped.documentId),
      headers,
      payload: { contentMd: `Saved by the ${who}\n`, expectedRevision },
    });
  return { db, seeded, admin, repoAdmin, save };
}

test('two saves naming one revision, one after the other, give one 200 and one 409, on whatever engine runs the suite', async () => {
  const { admin, repoAdmin, save } = await raceWorld();
  const won = await save('admin', admin, 1);
  const lost = await save('repository admin', repoAdmin, 1);
  expect([won.statusCode, lost.statusCode]).toEqual([200, 409]);
  expect(won.json<{ draft: { revision: number } }>().draft.revision).toBe(2);
  expect(lost.json<{ error: { code: string; details: unknown } }>().error).toMatchObject({
    code: 'draft_conflict',
    details: { currentRevision: 2 },
  });
  const again = await save('repository admin', repoAdmin, 2);
  expect(again.statusCode).toBe(200);
});

realPostgresOnly(
  'two simultaneous saves with the same revision give exactly one 200 and one 409, every time',
  async () => {
    const { db, seeded, admin, repoAdmin, save } = await raceWorld();
    await db.deleteFrom('cla_drafts').where('document_id', '=', seeded.t1.scoped.documentId).execute();
    let expected: number | null = null;
    for (let round = 1; round <= 5; round++) {
      const answers = await Promise.all([
        save('admin', admin, expected),
        save('repository admin', repoAdmin, expected),
      ]);
      const statuses = answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b);
      expect(statuses, `round ${round}`).toEqual([200, 409]);
      const winner = answers.find((answer) => answer.statusCode === 200);
      const loser = answers.find((answer) => answer.statusCode === 409);
      expect(winner?.json<{ draft: { revision: number } }>().draft.revision, `round ${round}`).toBe(round);
      expect(loser?.json<{ error: { code: string; details: unknown } }>().error, `round ${round}`).toMatchObject({
        code: 'draft_conflict',
        details: { currentRevision: round },
      });
      expected = round;
    }
    const saved = await db
      .selectFrom('audit_log')
      .select('metadata')
      .where('action', '=', 'cla_draft.saved')
      .orderBy('id')
      .execute();
    expect(saved.map((row) => row.metadata)).toEqual(
      [1, 2, 3, 4, 5].map((revision) => ({ document_id: seeded.t1.scoped.documentId, revision })),
    );
  },
);
