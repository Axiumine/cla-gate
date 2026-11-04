// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { contextOf, repoIdOf } from './sign-context-fixture/test-support.ts';
import {
  ADA_EMAIL,
  ADA_NAME,
  postSign,
  signedOf,
  signerWith,
  signingWorld,
  writtenRows,
} from './sign-fixture/test-support.ts';

// The sign request (E13-S04): what a new signature is made of and where each part is stored. The checks that refuse a request are
// in sign-routes-checks.test.ts, the repeat of a request in sign-routes-replay.test.ts, the other tenant in sign-routes-tenants.test.ts.

/** Matchers for the values the database chooses, typed `unknown` so that they can sit in an expected row. */
const ANY_DATE: unknown = expect.any(Date);
const ANY_NUMBER: unknown = expect.any(Number);

test('a signature is a 201 that names the signature, its version and its instant, and holds no name, address or login', async () => {
  const { world, ada, body } = await signingWorld();
  const response = await postSign(world, ada, body());
  const answer = signedOf(response, 201);
  const row = await world.db.selectFrom('signatures').select(['id', 'signed_at']).executeTakeFirstOrThrow();
  expect(answer).toEqual({
    signature: {
      id: row.id,
      versionId: world.t1.versionId,
      major: 1,
      minor: 0,
      signedAt: row.signed_at.toISOString(),
    },
    created: true,
  });
  expect(response.headers['cache-control']).toBe('no-store');
  for (const secret of [ADA_NAME, ADA_EMAIL.email, 'login-1234']) {
    expect(response.body).not.toContain(secret);
  }
});

test('the signature row carries the tenant of the repository, the person of the session and the version as it was shown', async () => {
  const { world, ada, body } = await signingWorld();
  const response = await postSign(world, ada, body());
  const answer = signedOf(response, 201);
  const row = await world.db
    .selectFrom('signatures')
    .selectAll()
    .where('id', '=', answer.signature.id)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({
    id: answer.signature.id,
    installation_id: world.t1.installationId,
    user_id: ada.userId,
    document_id: world.t1.documentId,
    version_id: world.t1.versionId,
    major: 1,
    content_sha256: world.t1.contentSha256,
    consent_text_id: 'individual-v1',
    signer_type: 'individual',
    signed_at: ANY_DATE,
    source_repository_id: world.t1.repositoryId,
    source_pr_number: 45,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
  });
});

test('the time of the signature is the clock of the database, not the clock of the test and not a value from the request', async () => {
  const { world, ada, body } = await signingWorld();
  const before = Date.now();
  const signed = signedOf(await postSign(world, ada, body()), 201);
  const at = Date.parse(signed.signature.signedAt);
  expect(at).toBeGreaterThanOrEqual(before - 1000);
  expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  expect(at).not.toBe(world.clock.now().getTime());
});

test('the personal data is stored in signer_pii: the cleaned name, the address as GitHub reported it and the login snapshot', async () => {
  const { world, ada, body } = await signingWorld();
  await world.db
    .updateTable('sessions')
    .set({ verified_emails: JSON.stringify([{ email: 'Ada@Example.org', primary: true }]) })
    .where('id', '=', ada.sessionId)
    .execute();
  const answer = signedOf(
    await postSign(world, ada, body({ name: '  Ada   Å  Lovelace ', email: ' ADA@example.ORG ' })),
    201,
  );
  const pii = await world.db.selectFrom('signer_pii').selectAll().executeTakeFirstOrThrow();
  expect(pii).toEqual({
    signature_id: answer.signature.id,
    user_id: ada.userId,
    name: 'Ada Å Lovelace',
    email: 'Ada@Example.org',
    login: 'login-1234',
    created_at: ANY_DATE,
  });
});

test('one audit row signature.created names the actor, the tenant and the signature, and holds ids only', async () => {
  const { world, ada, body } = await signingWorld();
  const answer = signedOf(await postSign(world, ada, body()), 201);
  const rows = await world.db.selectFrom('audit_log').selectAll().where('action', '=', 'signature.created').execute();
  expect(rows).toEqual([
    {
      id: ANY_NUMBER,
      occurred_at: ANY_DATE,
      installation_id: world.t1.installationId,
      actor_github_id: 1234,
      action: 'signature.created',
      subject_type: 'signature',
      subject_id: answer.signature.id,
      metadata: {
        document_id: world.t1.documentId,
        version_id: world.t1.versionId,
        major: 1,
        source_repository_id: world.t1.repositoryId,
        source_pr_number: 45,
      },
    },
  ]);
  const everything = JSON.stringify(await world.db.selectFrom('audit_log').selectAll().execute());
  for (const secret of [ADA_NAME, ADA_EMAIL.email, 'login-1234']) {
    expect(everything).not.toContain(secret);
  }
});

test('a signature made from the dashboard, with no pull request, stores no source pull request in the row or in the audit entry', async () => {
  const { world, ada, body } = await signingWorld();
  signedOf(await postSign(world, ada, body({ prNumber: undefined })), 201);
  const row = await world.db
    .selectFrom('signatures')
    .select(['source_repository_id', 'source_pr_number'])
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ source_repository_id: world.t1.repositoryId, source_pr_number: null });
  const audit = await world.db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'signature.created')
    .executeTakeFirstOrThrow();
  expect(audit.metadata).toMatchObject({ source_repository_id: world.t1.repositoryId, source_pr_number: null });
});

test('the sign page context follows the signature: ready before, already_signed after, with the id the answer named', async () => {
  const { world, ada, body } = await signingWorld();
  expect(contextOf(await world.ask(ada, repoIdOf(1))).state).toBe('ready');
  const answer = signedOf(await postSign(world, ada, body()), 201);
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context.state).toBe('already_signed');
  const { id, major, minor, signedAt } = answer.signature;
  expect(context.signature).toEqual({ id, major, minor, signedAt });
});

test('a person with two sessions signs once: the second session is told the signature exists', async () => {
  const { world, ada, body } = await signingWorld();
  const second = await signerWith(world, 1234, [ADA_EMAIL]);
  const first = signedOf(await postSign(world, ada, body()), 201);
  const again = signedOf(await postSign(world, second, body()), 200);
  expect(again).toEqual({ signature: first.signature, created: false });
  expect(await writtenRows(world.db)).toEqual({ signatures: 1, signerPii: 1, audit: 1 });
});
