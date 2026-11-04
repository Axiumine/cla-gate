// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { readPolicy } from '../../services/evaluate-pr/policy-facts.ts';
import { readSignatures } from '../../services/evaluate-pr/signature-facts.ts';
import { auditRows, documentWorld, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  answerOf,
  attachAs,
  pointAt,
  repositoryState,
  setEnabled,
  storeDocument,
} from './repository-document-fixture/test-support.ts';

// The cross-tenant checks of `PUT /api/repositories/:repositoryId/cla-document` (E14-S02): the other tenant's repository and its
// documents, the database behind the service, and what a change does to the signatures of the document it leaves.

test("the other tenant's repository id is 404 for either org admin, the answer for an id that exists nowhere, and no row of any tenant changes", async () => {
  const world = await documentWorld();
  const unknown = await attachAs(world, 'admin1', 987_654, world.t1.documentId);
  const before = await tablesOf(world);
  const answers = [
    await attachAs(world, 'admin1', world.t2.plain.repositoryId, world.t1.documentId),
    await attachAs(world, 'admin1', world.t2.scoped.repositoryId, world.t2.scoped.documentId),
    await attachAs(world, 'admin2', world.t1.plain.repositoryId, world.t2.documentId),
    await attachAs(world, 'admin2', world.t1.scoped.repositoryId, null),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});

test("the repository of the viewer with the other tenant's document is 422 document_not_attachable, as it is for an id that exists nowhere, in both directions", async () => {
  const world = await documentWorld();
  const unknown = await attachAs(world, 'admin1', world.t1.plain.repositoryId, 987_654);
  const before = await tablesOf(world);
  const crossed = [
    await attachAs(world, 'admin1', world.t1.plain.repositoryId, world.t2.documentId),
    await attachAs(world, 'admin1', world.t1.plain.repositoryId, world.t2.scoped.documentId),
    await attachAs(world, 'admin2', world.t2.plain.repositoryId, world.t1.documentId),
    await attachAs(world, 'admin2', world.t2.scoped.repositoryId, world.t1.scoped.documentId),
  ];
  expect(crossed.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual(
    crossed.map(() => [422, 'document_not_attachable']),
  );
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});

test('a change in one tenant writes its audit row under that tenant and touches no repository, document or audit row of the other', async () => {
  const world = await documentWorld();
  const { t1, t2 } = world;
  const otherRepositories = await world.db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const otherAudit = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const response = await attachAs(world, 'admin1', t1.plain.repositoryId, t1.documentId);
  expect(response.statusCode).toBe(200);
  const rows = await auditRows(world, 'repository.cla_document_attached');
  expect(rows.map((row) => row.installation_id)).toEqual([t1.installationId]);
  expect(
    await world.db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherRepositories);
  expect(
    await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherAudit);
});

test('the database is the second line of defence: a document of another tenant set on a repository with raw SQL is a foreign key violation', async () => {
  const world = await documentWorld();
  const attempt = sql`update repositories set cla_document_id = ${world.t2.documentId} where id = ${world.t1.plain.repositoryId}`;
  await expect(attempt.execute(world.db)).rejects.toMatchObject({
    code: '23503',
    constraint: 'repositories_cla_document_fk',
  });
  const insert = sql`update repositories set cla_document_id = ${world.t2.scoped.documentId} where id = ${world.t1.scoped.repositoryId}`;
  await expect(insert.execute(world.db)).rejects.toMatchObject({ code: '23503' });
  expect((await repositoryState(world, world.t1.plain.repositoryId)).cla_document_id).toBeNull();
});

test('the signatures made under the document a repository leaves stop covering it, and are left as they are', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  const signer = world.people.member1.githubId;
  const second = await storeDocument(world, { name: 'Second wide CLA', published: true });
  const scope = { db: world.db, installationId: t1.installationId, repositoryId: t1.plain.repositoryId };
  /** What the evaluation of the repository reads as its policy, from the pointer the route left. */
  const policy = async () => readPolicy(scope, (await repositoryState(world, t1.plain.repositoryId)).cla_document_id);
  expect((await attachAs(world, 'admin1', t1.plain.repositoryId, t1.documentId)).statusCode).toBe(200);
  expect(await policy()).toEqual({ documentId: t1.documentId, activeMajor: 1 });
  expect(await readSignatures(scope, t1.documentId, [signer])).toHaveLength(1);
  const { signatures } = await tablesOf(world);
  expect((await attachAs(world, 'admin1', t1.plain.repositoryId, second)).statusCode).toBe(200);
  expect(await policy()).toEqual({ documentId: second, activeMajor: 1 });
  expect(await readSignatures(scope, second, [signer])).toEqual([]);
  expect((await tablesOf(world))['signatures']).toEqual(signatures);
});

test("an org admin detaches in their own tenant and is refused the other tenant's document for the same repository", async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t2.scoped.repositoryId, false);
  await pointAt(world, world.t2.scoped.repositoryId, world.t2.documentId);
  const own = await attachAs(world, 'admin2', world.t2.scoped.repositoryId, null);
  expect(answerOf(own)).toEqual({ documentId: null, changed: true });
  const crossed = await attachAs(world, 'admin2', world.t2.scoped.repositoryId, world.t1.documentId);
  expect(crossed.statusCode).toBe(422);
  expect((await repositoryState(world, world.t2.scoped.repositoryId)).cla_document_id).toBeNull();
});
