// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  ADA_EMAIL,
  ADA_ID,
  ANY_NUMBER,
  bodyFor,
  corporateWorld,
  createdOf,
  failureOf,
  NOTHING_WRITTEN,
  ONE_AGREEMENT,
  postAgreement,
  signerWith,
  UTC_INSTANT,
  watchRows,
} from './corporate-fixture/test-support.ts';

// `POST /api/corporate/agreements` (E21-S02): what one signing writes, to which tables, and what the answer holds.

test('a signing answers 201 with the agreement and holds no name, title or address', async () => {
  const world = await corporateWorld();
  const response = await postAgreement(world, world.ada, bodyFor(world.c1));
  const agreement = createdOf(response);
  expect(agreement).toEqual({
    id: ANY_NUMBER,
    signatureId: ANY_NUMBER,
    versionId: world.c1.document.versionId,
    major: 1,
    signedAt: UTC_INSTANT,
  });
  expect(response.headers['cache-control']).toBe('no-store');
  for (const secret of ['Acme GmbH', 'Chief Legal Officer', 'Ada Lovelace', ADA_EMAIL.email]) {
    expect(response.body).not.toContain(secret);
  }
});

test('one signing writes the signature of type corporate with the corporate consent, and its personal data', async () => {
  const world = await corporateWorld();
  const { signatureId } = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const { db, c1 } = world;
  const signature = await db
    .selectFrom('signatures')
    .selectAll()
    .where('id', '=', signatureId)
    .executeTakeFirstOrThrow();
  expect(signature).toMatchObject({
    installation_id: c1.tenant.installationId,
    user_id: world.ada.userId,
    document_id: c1.document.documentId,
    version_id: c1.document.versionId,
    major: 1,
    content_sha256: c1.document.contentSha256,
    consent_text_id: 'corporate-v1',
    signer_type: 'corporate',
    source_repository_id: c1.tenant.plain.repositoryId,
    source_pr_number: null,
    revoked_at: null,
  });
  const pii = await db
    .selectFrom('signer_pii')
    .select(['name', 'email', 'login', 'ip_address', 'user_agent'])
    .where('signature_id', '=', signatureId)
    .execute();
  expect(pii).toEqual([
    { name: 'Ada Lovelace', email: ADA_EMAIL.email, login: `login-${ADA_ID}`, ip_address: null, user_agent: null },
  ]);
});

test('one signing writes the agreement and its text, one row of each table of the story', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const { id, signatureId } = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const { db, c1 } = world;
  expect(await written()).toEqual(ONE_AGREEMENT);
  expect(
    await db
      .selectFrom('corporate_agreements')
      .select(['signature_id', 'document_id', 'major'])
      .where('id', '=', id)
      .execute(),
  ).toEqual([{ signature_id: signatureId, document_id: c1.document.documentId, major: 1 }]);
  expect(
    await db
      .selectFrom('corporate_agreement_pii')
      .select(['company_name', 'signatory_title'])
      .where('agreement_id', '=', id)
      .execute(),
  ).toEqual([{ company_name: 'Acme GmbH', signatory_title: 'Chief Legal Officer' }]);
});

test('the approval of the signatory is a manager approval by their numeric id, with the login snapshot in its own table', async () => {
  const world = await corporateWorld();
  const { id } = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const { db, c1 } = world;
  const approvals = await db
    .selectFrom('corporate_approvals')
    .select([
      'id',
      'installation_id',
      'kind',
      'subject_github_id',
      'subject_domain',
      'source',
      'approved_by',
      'revoked_at',
    ])
    .where('agreement_id', '=', id)
    .execute();
  expect(approvals).toEqual([
    {
      id: ANY_NUMBER,
      installation_id: c1.tenant.installationId,
      kind: 'user',
      subject_github_id: ADA_ID,
      subject_domain: null,
      source: 'manager',
      approved_by: world.ada.userId,
      revoked_at: null,
    },
  ]);
  const [approval] = approvals;
  expect(
    await db
      .selectFrom('corporate_approval_pii')
      .select('login')
      .where('approval_id', '=', approval?.id ?? 0)
      .execute(),
  ).toEqual([{ login: `login-${ADA_ID}` }]);
});

test('the audit row names the numbers and the major only, never a name, a title, an address or a login', async () => {
  const world = await corporateWorld();
  const { id, signatureId } = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const rows = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'corporate_agreement.signed')
    .execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: world.c1.tenant.installationId,
    actor_github_id: ADA_ID,
    subject_type: 'corporate_agreement',
    subject_id: id,
    metadata: {
      document_id: world.c1.document.documentId,
      version_id: world.c1.document.versionId,
      signature_id: signatureId,
      major: 1,
      source_repository_id: world.c1.tenant.plain.repositoryId,
    },
  });
  const text = JSON.stringify(rows);
  for (const secret of ['Acme GmbH', 'Chief Legal Officer', 'Ada Lovelace', ADA_EMAIL.email, `login-${ADA_ID}`]) {
    expect(text).not.toContain(secret);
  }
});

test('the company name and the title are stored in Unicode NFC with their ends trimmed and runs of spaces made one space', async () => {
  const world = await corporateWorld();
  const { id } = createdOf(
    await postAgreement(
      world,
      world.ada,
      bodyFor(world.c1, { companyName: '  Café   AG ', signatoryTitle: ' Head   of Legal ' }),
    ),
  );
  expect(
    await world.db
      .selectFrom('corporate_agreement_pii')
      .select(['company_name', 'signatory_title'])
      .where('agreement_id', '=', id)
      .execute(),
  ).toEqual([{ company_name: 'Café AG', signatory_title: 'Head of Legal' }]);
});

test.each([
  [
    'the primary address when there is one',
    [{ email: 'first@example.org', primary: false }, ADA_EMAIL],
    ADA_EMAIL.email,
  ],
  [
    'the first address when none is primary',
    [
      { email: 'first@example.org', primary: false },
      { email: 'second@example.org', primary: false },
    ],
    'first@example.org',
  ],
])('the address stored with the signature is %s of the session', async (_label, emails, expected) => {
  const world = await corporateWorld();
  const signer = await signerWith(world, 2345, emails);
  const { signatureId } = createdOf(await postAgreement(world, signer, bodyFor(world.c1)));
  expect(
    await world.db.selectFrom('signer_pii').select('email').where('signature_id', '=', signatureId).execute(),
  ).toEqual([{ email: expected }]);
});

test('a session with no verified address is a 422 no_verified_email and writes nothing', async () => {
  const world = await corporateWorld();
  const signer = await signerWith(world, 2345, []);
  const written = await watchRows(world.db);
  const response = await postAgreement(world, signer, bodyFor(world.c1, { typedName: 'zzzz Name' }));
  expect(failureOf(response)).toEqual([422, 'no_verified_email']);
  expect(response.body).not.toContain('zzzz');
  expect(await written()).toEqual(NOTHING_WRITTEN);
});

test('a typed name that cannot be a name is a 422 invalid_name and writes nothing', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const response = await postAgreement(world, world.ada, bodyFor(world.c1, { typedName: '   ' }));
  expect(failureOf(response)).toEqual([422, 'invalid_name']);
  expect(await written()).toEqual(NOTHING_WRITTEN);
});

test('the same person signs under another tenant: one agreement for each corporate document', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const first = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const second = createdOf(await postAgreement(world, world.ada, bodyFor(world.c2)));
  expect(second.id).not.toBe(first.id);
  expect((await written()).agreements).toBe(2);
});

test('a body that is not the schema is a 400 and writes nothing', async () => {
  const world = await corporateWorld();
  const written = await watchRows(world.db);
  const answers = await Promise.all(
    [
      { ...bodyFor(world.c1), extra: 1 },
      bodyFor(world.c1, { githubRepoId: '9000' }),
      bodyFor(world.c1, { authorityConfirmed: 'yes' }),
      bodyFor(world.c1, { contentSha256: 'ABC' }),
      bodyFor(world.c1, { companyName: 7 }),
      [],
    ].map((body) => postAgreement(world, world.ada, body)),
  );
  expect(answers.map((answer) => answer.statusCode)).toEqual([400, 400, 400, 400, 400, 400]);
  expect(errorResponseSchema.parse(answers[0]?.json()).error.code).toBe('bad_request');
  expect(await written()).toEqual(NOTHING_WRITTEN);
});
