// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DATA_EXPORT_AUDIT_LIMIT } from '../../../shared/data-export.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { seedAllowlist, seedAudit } from '../../services/export/own-data-fixture/test-support.ts';
import { ADA, adaWorld, REVOKER, rawDocument } from './data-export-fixture/test-support.ts';

// What the export of a person's own data holds (E16-S06), for a person who signed in both tenants: the signatures with their
// personal data (none once erased), the allowlist entries that name the person and the audit rows in which they are actor or
// subject. Whose data it may be is data-export-tenants.test.ts.

const ADA_PII = { login: 'ada', name: 'Ada Lovelace', email: 'ada@example.test' };

const anyString: unknown = expect.any(String);

/** Ada's world with the rows of the stored snapshot: two signatures in tenant 1 (one revoked), an erased one in tenant 2, and what surrounds them. */
async function stored() {
  const state = await adaWorld();
  const { db, t1, t2 } = state;
  await seedSignatures(db, t1, [
    { githubId: ADA, pii: ADA_PII, signedAtMs: 0 },
    {
      githubId: ADA,
      pii: { login: 'ada-old', name: 'A. Lovelace', email: 'old@example.test' },
      signedAtMs: 1000,
      revoked: { afterMs: 5000, byGithubId: REVOKER, reason: 'maintainer_decision' },
    },
  ]);
  await seedSignatures(db, t2, [{ githubId: ADA, pii: null, signedAtMs: 2000, repositoryId: null }]);
  await seedAround(state);
  return state;
}

/** The rows around Ada's signatures: allowlist entries that name her and another person, and audit rows in which she and others act. */
async function seedAround({ db, t1, t2 }: Pick<Awaited<ReturnType<typeof adaWorld>>, 'db' | 't1' | 't2'>) {
  await seedAllowlist(db, [
    { tenant: t1, githubId: ADA, createdAtMs: 10_000 },
    { tenant: t2, githubId: ADA, kind: 'bot', repositoryId: t2.plain.repositoryId, createdAtMs: 20_000 },
    { tenant: t1, githubId: 31_005, createdAtMs: 30_000 },
  ]);
  await seedAudit(db, [
    {
      action: 'signature.created',
      installationId: t1.installationId,
      actorGithubId: ADA,
      atMs: 40_000,
      subject: { type: 'signature', id: 9 },
    },
    {
      action: 'signer_pii.erased',
      installationId: t1.installationId,
      actorGithubId: REVOKER,
      atMs: 50_000,
      subject: { type: 'user', id: ADA },
    },
    {
      action: 'signer_pii.erased',
      installationId: t1.installationId,
      actorGithubId: REVOKER,
      atMs: 50_000,
      subject: { type: 'user', id: 31_005 },
    },
    {
      action: 'data_export.created',
      installationId: null,
      actorGithubId: ADA,
      atMs: 60_000,
      subject: { type: 'user', id: ADA },
    },
    {
      action: 'signature.revoked',
      installationId: t1.installationId,
      actorGithubId: REVOKER,
      atMs: 70_000,
      subject: { type: 'signature', id: 8 },
    },
    { action: 'repository.enabled', installationId: t2.installationId, actorGithubId: ADA, atMs: 50_000 },
  ]);
}

test('the document of a person who signed in two tenants is the file stored as a snapshot', async () => {
  const { getAda } = await stored();
  const response = await getAda();
  expect(response.statusCode).toBe(200);
  await expect(`${JSON.stringify(response.json(), null, 2)}\n`).toMatchFileSnapshot('api-snapshots/data-export.json');
});

test('the signatures are newest first and carry the installation, the document, the version, the source and the revocation', async () => {
  const { exportedAda, t1, t2 } = await stored();
  const { signatures } = await exportedAda();
  expect(signatures.map((signature) => [signature.installation.githubInstallationId, signature.signedAt])).toEqual([
    [t2.githubInstallationId, '2026-10-15T09:00:02.000Z'],
    [t1.githubInstallationId, '2026-10-15T09:00:01.000Z'],
    [t1.githubInstallationId, '2026-10-15T09:00:00.000Z'],
  ]);
  expect(signatures[1]).toMatchObject({
    installation: { accountLogin: 'org-1' },
    document: { id: t1.documentId },
    version: { id: t1.versionId, major: 1, minor: 0, contentSha256: t1.contentSha256 },
    consentTextId: 'consent-v1',
    signerType: 'individual',
    source: { repositoryFullName: 'org-1/repo', prNumber: 7 },
    revokedAt: '2026-10-15T09:00:06.000Z',
    revokeReasonCode: 'maintainer_decision',
  });
  expect(signatures[2]).toMatchObject({ revokedAt: null, revokeReasonCode: null });
});

test('a signature whose personal data was erased has personalData null, and a signature with none of a repository has no source', async () => {
  const { exportedAda } = await stored();
  const [erased, revoked, active] = (await exportedAda()).signatures;
  expect(erased).toMatchObject({ personalData: null, source: { repositoryFullName: null, prNumber: null } });
  expect(revoked?.personalData).toEqual({
    name: 'A. Lovelace',
    email: 'old@example.test',
    login: 'ada-old',
    ipAddress: null,
    userAgent: null,
  });
  expect(active?.personalData).toEqual({
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    login: 'ada',
    ipAddress: null,
    userAgent: null,
  });
});

test('nothing in the document names another person: not who revoked, not who made an entry, not the actor of a row', async () => {
  const { getAda } = await stored();
  const response = await getAda();
  const body = rawDocument(response.json());
  expect(body.keys).toEqual([
    'schemaVersion',
    'exportedAt',
    'user',
    'signatures',
    'allowlistEntries',
    'auditEntries',
    'truncated',
  ]);
  expect(Object.keys(body.signatures[1] ?? {})).toEqual([
    'id',
    'installation',
    'document',
    'version',
    'consentTextId',
    'signerType',
    'signedAt',
    'source',
    'revokedAt',
    'revokeReasonCode',
    'personalData',
  ]);
  expect(Object.keys(body.allowlistEntries[0] ?? {})).toEqual(['installation', 'scope', 'kind', 'createdAt']);
  expect(Object.keys(body.auditEntries[0] ?? {})).toEqual(['occurredAt', 'action', 'installationId', 'subject']);
  expect(response.body).not.toContain('revoked_by');
  expect(response.body).not.toContain(String(REVOKER));
  expect(response.body).not.toContain('31005');
});

test('the allowlist entries are the ones that name the person, newest first, with their scope and kind', async () => {
  const { exportedAda } = await stored();
  expect((await exportedAda()).allowlistEntries).toEqual([
    {
      installation: { accountLogin: 'org-2' },
      scope: 'repository',
      kind: 'bot',
      createdAt: '2026-10-15T09:00:20.000Z',
    },
    {
      installation: { accountLogin: 'org-1' },
      scope: 'installation',
      kind: 'user',
      createdAt: '2026-10-15T09:00:10.000Z',
    },
  ]);
});

test('the audit entries are the rows where the person is the actor or the subject of a user row, newest first', async () => {
  const { exportedAda, t1, t2 } = await stored();
  const document = await exportedAda();
  expect(document.truncated).toBe(false);
  expect(document.auditEntries).toEqual([
    {
      occurredAt: '2026-10-15T09:01:00.000Z',
      action: 'data_export.created',
      installationId: null,
      subject: { type: 'user', id: ADA },
    },
    {
      occurredAt: '2026-10-15T09:00:50.000Z',
      action: 'repository.enabled',
      installationId: t2.githubInstallationId,
      subject: null,
    },
    {
      occurredAt: '2026-10-15T09:00:50.000Z',
      action: 'signer_pii.erased',
      installationId: t1.githubInstallationId,
      subject: { type: 'user', id: ADA },
    },
    {
      occurredAt: '2026-10-15T09:00:40.000Z',
      action: 'signature.created',
      installationId: t1.githubInstallationId,
      subject: { type: 'signature', id: 9 },
    },
  ]);
});

test('an admin who erased someone gets the row of the erasure with no subject: the id of the person erased is not theirs to take', async () => {
  const { db, t1, getAda, exportedAda } = await adaWorld();
  const ERASED = 31_005;
  await seedAudit(db, [
    {
      action: 'signer_pii.erased',
      installationId: t1.installationId,
      actorGithubId: ADA,
      atMs: 1000,
      subject: { type: 'user', id: ERASED },
    },
    {
      action: 'signer_pii.erased',
      installationId: t1.installationId,
      actorGithubId: ERASED,
      atMs: 2000,
      subject: { type: 'user', id: ADA },
    },
  ]);
  expect((await exportedAda()).auditEntries).toEqual([
    {
      occurredAt: '2026-10-15T09:00:02.000Z',
      action: 'signer_pii.erased',
      installationId: t1.githubInstallationId,
      subject: { type: 'user', id: ADA },
    },
    {
      occurredAt: '2026-10-15T09:00:01.000Z',
      action: 'signer_pii.erased',
      installationId: t1.githubInstallationId,
      subject: null,
    },
  ]);
  expect((await getAda()).body).not.toContain(String(ERASED));
});

test.each([
  [DATA_EXPORT_AUDIT_LIMIT, false],
  [DATA_EXPORT_AUDIT_LIMIT + 1, true],
])(
  'with %i audit rows of the person the document holds 1000 newest first and truncated is %s',
  async (rows, truncated) => {
    const { db, exportedAda } = await adaWorld();
    await seedAudit(
      db,
      Array.from({ length: rows }, (_unused, index) => ({
        action: 'signature.created',
        installationId: null,
        actorGithubId: ADA,
        atMs: index * 1000,
      })),
    );
    const document = await exportedAda();
    expect(document.truncated).toBe(truncated);
    expect(document.auditEntries).toHaveLength(DATA_EXPORT_AUDIT_LIMIT);
    expect(document.auditEntries[0]?.occurredAt).toBe(
      new Date(Date.parse('2026-10-15T09:00:00.000Z') + (rows - 1) * 1000).toISOString(),
    );
    expect(document.auditEntries.at(-1)?.occurredAt).toBe(
      new Date(Date.parse('2026-10-15T09:00:00.000Z') + (rows - DATA_EXPORT_AUDIT_LIMIT) * 1000).toISOString(),
    );
  },
);

test('the next export shows the row of the one before, and the user block is the stored row', async () => {
  const { exportedAda } = await adaWorld();
  const first = await exportedAda();
  expect(first.user).toEqual({
    githubId: ADA,
    login: 'ada',
    name: 'Ada Lovelace',
    createdAt: '2026-09-01T08:00:00.000Z',
  });
  expect(first.auditEntries).toEqual([]);
  const second = await exportedAda();
  expect(second.auditEntries).toEqual([
    {
      occurredAt: anyString,
      action: 'data_export.created',
      installationId: null,
      subject: { type: 'user', id: ADA },
    },
  ]);
});
