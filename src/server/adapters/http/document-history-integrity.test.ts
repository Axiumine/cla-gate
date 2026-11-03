// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { documentWorld, listVersionsAs, parsed, readVersionAs, storeVersion } from './document-fixture/test-support.ts';

// The integrity of what GET .../versions/:versionId serves (E12-S05): the server hashes the stored text again and compares it
// with the stored hash. The database check on `cla_versions` and its triggers make a mismatch unreachable in normal operation, so
// the test takes the check and the trigger away from its own throwaway database and tampers with a row. The same check
// below the route, with a repository double, is in cla-history.test.ts.

const TAMPERED = 'Wording nobody published, TAMPERED-MARKER\n';

/** Tampers with the text of a version in the database of the world: the hash check and the immutability trigger are dropped there first. */
async function tamper(world: Awaited<ReturnType<typeof documentWorld>>, versionId: number): Promise<void> {
  await sql`alter table cla_versions drop constraint cla_versions_check`.execute(world.db);
  await sql`alter table cla_versions disable trigger cla_versions_immutable`.execute(world.db);
  await world.db.updateTable('cla_versions').set({ content_md: TAMPERED }).where('id', '=', versionId).execute();
}

test('a version whose text no longer hashes to its hash is a plain 500 with nothing of the row in the body, and a log line with ids only', async () => {
  const world = await documentWorld();
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const versionId = await storeVersion(world, world.t1.documentId, {
    major: 1,
    minor: 1,
    text: 'Wording that was published\n',
    rationale: 'A rationale',
  });
  await tamper(world, versionId);
  const response = await readVersionAs(world, 'admin1', target, versionId);
  expect(response.statusCode).toBe(500);
  expect(parsed(response, errorResponseSchema)).toEqual({
    error: {
      code: 'internal_server_error',
      message: 'Internal Server Error',
      requestId: response.headers['x-request-id'],
    },
  });
  expect(response.body).not.toContain('TAMPERED-MARKER');
  const lines = world.logs.lines().filter((line) => line['msg'] === 'cla_version_integrity_failed');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    level: 50,
    installationId: world.t1.installationId,
    documentId: world.t1.documentId,
    versionId,
  });
  const logged = world.logs.text();
  expect(logged).not.toContain('TAMPERED-MARKER');
  expect(logged).not.toContain('A rationale');
  expect(logged).not.toContain(world.t1.contentSha256);
});

test('the other versions of the document are still served, and the list, which carries hashes and no text, answers as before', async () => {
  const world = await documentWorld();
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const versionId = await storeVersion(world, world.t1.documentId, {
    major: 1,
    minor: 1,
    text: 'Wording that was published\n',
    rationale: 'r',
  });
  await tamper(world, versionId);
  expect((await readVersionAs(world, 'admin1', target, world.t1.versionId)).statusCode).toBe(200);
  expect((await readVersionAs(world, 'admin1', target, versionId)).statusCode).toBe(500);
  expect((await listVersionsAs(world, 'admin1', target)).statusCode).toBe(200);
  expect(world.logs.lines().filter((line) => line['msg'] === 'cla_version_integrity_failed')).toHaveLength(1);
});
