// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { contextOf, errorCodeOf, repoIdOf, withoutRequestId } from './sign-context-fixture/test-support.ts';
import { bodyFor, postSign, signedOf, signerWith, signingWorld, writtenRows } from './sign-fixture/test-support.ts';

// The sign request and the tenants (E13-S04): signing is open to any signed-in person, and the tenant is the one that holds the
// repository the request names. A signature belongs to that tenant alone, and an id of another tenant in the request confirms nothing.

test("a signature for tenant 1's repository carries tenant 1's installation id and never covers tenant 2's document", async () => {
  const { world, ada, body } = await signingWorld();
  signedOf(await postSign(world, ada, body()), 201);
  const row = await world.db.selectFrom('signatures').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({ installation_id: world.t1.installationId, document_id: world.t1.documentId });
  const other = contextOf(await world.ask(ada, repoIdOf(2)));
  expect(other).toMatchObject({ state: 'ready', signature: null, revoked: null });
  expect(other.document.id).toBe(world.t2.documentId);
});

test("the same person signs both tenants' documents: two rows, each with its own tenant, document, version and audit entry", async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  const second = signedOf(await postSign(world, ada, bodyFor(world.t2, 2)), 201);
  expect(second.signature.id).not.toBe(first.signature.id);
  const rows = await world.db
    .selectFrom('signatures')
    .select(['id', 'installation_id', 'document_id', 'version_id'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    {
      id: first.signature.id,
      installation_id: world.t1.installationId,
      document_id: world.t1.documentId,
      version_id: world.t1.versionId,
    },
    {
      id: second.signature.id,
      installation_id: world.t2.installationId,
      document_id: world.t2.documentId,
      version_id: world.t2.versionId,
    },
  ]);
  const audit = await world.db
    .selectFrom('audit_log')
    .select(['installation_id', 'subject_id'])
    .where('action', '=', 'signature.created')
    .orderBy('id')
    .execute();
  expect(audit).toEqual([
    { installation_id: world.t1.installationId, subject_id: first.signature.id },
    { installation_id: world.t2.installationId, subject_id: second.signature.id },
  ]);
});

test("a signature the person has for tenant 2's document does not turn a request for tenant 1's into a repeat", async () => {
  const { world, ada } = await signingWorld();
  signedOf(await postSign(world, ada, bodyFor(world.t2, 2)), 201);
  const answer = signedOf(await postSign(world, ada, bodyFor(world.t1, 1)), 201);
  expect(answer.created).toBe(true);
  expect(await writtenRows(world.db)).toEqual({ signatures: 2, signerPii: 2, audit: 2 });
});

test("tenant 2's repository id with tenant 1's version id is stale_version, and so is the reverse, and nothing is written", async () => {
  const { world, ada } = await signingWorld();
  const intoTwo = await postSign(world, ada, bodyFor(world.t1, 2));
  const intoOne = await postSign(world, ada, bodyFor(world.t2, 1));
  expect([intoTwo.statusCode, errorCodeOf(intoTwo)]).toEqual([409, 'stale_version']);
  expect([intoOne.statusCode, errorCodeOf(intoOne)]).toEqual([409, 'stale_version']);
  expect(intoTwo.json<{ error: { details: unknown } }>().error.details).toEqual({
    current: { versionId: world.t2.versionId, major: 1, minor: 0, contentSha256: world.t2.contentSha256 },
  });
  expect(intoOne.json<{ error: { details: unknown } }>().error.details).toEqual({
    current: { versionId: world.t1.versionId, major: 1, minor: 0, contentSha256: world.t1.contentSha256 },
  });
  expect(await writtenRows(world.db)).toEqual({ signatures: 0, signerPii: 0, audit: 0 });
});

test('a version id of another tenant answers exactly as a version id that exists nowhere, so it confirms nothing about the tenant', async () => {
  const { world, ada } = await signingWorld();
  const foreign = await postSign(world, ada, bodyFor(world.t1, 1, { versionId: world.t2.versionId }));
  const nowhere = await postSign(world, ada, bodyFor(world.t1, 1, { versionId: 987_654 }));
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(nowhere));
});

test("a tenant that is suspended does not stop a person from signing the other tenant's document", async () => {
  const { world, ada } = await signingWorld();
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t2.installationId)
    .execute();
  const hidden = await postSign(world, ada, bodyFor(world.t2, 2));
  expect([hidden.statusCode, errorCodeOf(hidden)]).toEqual([404, 'not_found']);
  signedOf(await postSign(world, ada, bodyFor(world.t1, 1)), 201);
});

test('the person is the one of the session: a body that names a person is a 400, and each session signs for itself', async () => {
  const { world, ada, body } = await signingWorld();
  const eve = await signerWith(world, 4321);
  const named = await postSign(world, ada, body({ userId: eve.userId, githubId: 4321 }));
  expect([named.statusCode, errorCodeOf(named)]).toEqual([400, 'bad_request']);
  const forAda = signedOf(await postSign(world, ada, body()), 201);
  const forEve = signedOf(await postSign(world, eve, body()), 201);
  const rows = await world.db.selectFrom('signatures').select(['id', 'user_id']).orderBy('id').execute();
  expect(rows).toEqual([
    { id: forAda.signature.id, user_id: ada.userId },
    { id: forEve.signature.id, user_id: eve.userId },
  ]);
  const actors = await world.db
    .selectFrom('audit_log')
    .select('actor_github_id')
    .where('action', '=', 'signature.created')
    .orderBy('id')
    .execute();
  expect(actors).toEqual([{ actor_github_id: 1234 }, { actor_github_id: 4321 }]);
});
