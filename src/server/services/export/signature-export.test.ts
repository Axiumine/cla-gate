// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { SIGNATURE_CSV_COLUMNS } from '../../../shared/signature-export.ts';
import { migratedTestDatabase, seedTenant } from '../../adapters/db/test-support.ts';
import { neutraliseFormula } from '../../domain/csv.ts';
import { csvRecords, parseCsv } from '../../domain/csv-fixture/test-support.ts';
import { HOSTILE_DOCUMENT_NAME, HOSTILE_SEEDS, runExport, seedSignatures } from './export-fixture/test-support.ts';

// The file the export writes (E16-S03), read from the migrated database: the columns, the hostile dataset stored as a
// snapshot, the cells of an erased and of a revoked signature, and the audit row the export leaves.

const HEADER = SIGNATURE_CSV_COLUMNS.join(',');

async function world(documentName?: string) {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  if (documentName !== undefined) {
    await db.updateTable('cla_documents').set({ name: documentName }).where('id', '=', tenant.documentId).execute();
  }
  const scope = { installationId: tenant.installationId };
  const filter = { documentId: tenant.documentId, state: 'all' } as const;
  return { db, tenant, scope, filter };
}

test('the header row is the twenty columns of the story in order, and a document with no signatures exports it alone', async () => {
  const { db, scope, filter } = await world();
  const run = await runExport(db, scope, filter);
  expect(run.text).toBe(`${HEADER}\r\n`);
  expect(SIGNATURE_CSV_COLUMNS).toHaveLength(20);
  expect(HEADER).toBe(
    'signature_id,github_user_id,login,name,email,document_id,document_name,version_major,version_minor,content_sha256,consent_text_id,signer_type,signed_at,source_repository,source_pr_number,state,revoked_at,revoked_by_github_id,revoke_reason_code,pii_erased',
  );
  expect(run.rowCount).toBe(0);
  expect(run.releaseErrors).toEqual([]);
});

test('the export of the hostile dataset is the file stored as a snapshot, with CRLF line ends and no byte order mark', async () => {
  const { db, tenant, scope, filter } = await world(HOSTILE_DOCUMENT_NAME);
  await seedSignatures(db, tenant, HOSTILE_SEEDS);
  const run = await runExport(db, scope, filter);
  await expect(run.text).toMatchFileSnapshot('csv-snapshots/hostile-dataset.csv');
  expect(run.text.endsWith('\r\n')).toBe(true);
  expect(run.text.replaceAll('\r\n', '')).not.toContain('\r');
  expect(run.bytes.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(run.bytes.subarray(0, 12).toString('utf8')).toBe('signature_id');
});

test('every entry of HOSTILE_NAMES comes out as one name cell, guarded when it starts a formula, and no cell begins with a trigger', async () => {
  const { db, tenant, scope, filter } = await world(HOSTILE_DOCUMENT_NAME);
  await seedSignatures(db, tenant, HOSTILE_SEEDS);
  const text = (await runExport(db, scope, filter)).text;
  const records = csvRecords(text);
  expect(records).toHaveLength(HOSTILE_SEEDS.length);
  expect(records.slice(0, HOSTILE_NAMES.length).map((record) => record['name'])).toEqual(
    HOSTILE_NAMES.map(neutraliseFormula),
  );
  const cells = parseCsv(text).slice(1).flat();
  expect(cells.filter((cell) => /^[=+\-@\t\r]/.test(cell))).toEqual([]);
  expect(records.map((record) => record['document_name'])).toEqual(
    Array.from({ length: records.length }, () => `'${HOSTILE_DOCUMENT_NAME}`),
  );
});

test('an email whose local part begins with + or -, and a name with a comma, a double quote and a line break, are guarded and whole', async () => {
  const { db, tenant, scope, filter } = await world();
  await seedSignatures(db, tenant, HOSTILE_SEEDS);
  const byLogin = new Map(
    csvRecords((await runExport(db, scope, filter)).text).map((record) => [record['login'], record]),
  );
  expect(byLogin.get('address-0')?.['email']).toBe("'+plus@example.test");
  expect(byLogin.get('address-1')?.['email']).toBe("'-minus@example.test");
  expect(byLogin.get('multi-line')?.['name']).toBe('Smith, "Ada"\nLovelace');
});

test('a signature whose personal data was erased has empty login, name and email and pii_erased true; the others say false', async () => {
  const { db, tenant, scope, filter } = await world();
  await seedSignatures(db, tenant, [{ githubId: 41 }, { githubId: 42, pii: null }]);
  const [kept, erased] = csvRecords((await runExport(db, scope, filter)).text);
  expect(kept).toMatchObject({
    github_user_id: '41',
    login: 'login-41',
    name: 'Name 41',
    email: 'u41@example.test',
    pii_erased: 'false',
  });
  expect(erased).toMatchObject({ github_user_id: '42', login: '', name: '', email: '', pii_erased: 'true' });
});

test('a document whose signers were all erased still has its rows: no personal data in any cell and pii_erased true on every one', async () => {
  const { db, tenant, scope, filter } = await world();
  await seedSignatures(db, tenant, [
    { githubId: 43, pii: null },
    { githubId: 44, pii: null },
  ]);
  const records = csvRecords((await runExport(db, scope, filter)).text);
  expect(records.map((record) => [record['github_user_id'], record['login'], record['name'], record['email']])).toEqual(
    [
      ['43', '', '', ''],
      ['44', '', '', ''],
    ],
  );
  expect(records.map((record) => record['pii_erased'])).toEqual(['true', 'true']);
});

test('the cells of a signature: ids, the version, the source, ISO timestamps with milliseconds, and the revocation', async () => {
  const { db, tenant, scope, filter } = await world();
  await seedSignatures(db, tenant, [
    { githubId: 51, signedAtMs: 1234 },
    {
      githubId: 52,
      signedAtMs: 2000,
      repositoryId: null,
      revoked: { afterMs: 500, byGithubId: 53, reason: 'maintainer_decision' },
    },
  ]);
  const [active, revoked] = csvRecords((await runExport(db, scope, filter)).text);
  expect(active).toEqual({
    signature_id: String(active?.['signature_id']),
    github_user_id: '51',
    login: 'login-51',
    name: 'Name 51',
    email: 'u51@example.test',
    document_id: String(tenant.documentId),
    document_name: 'Individual CLA',
    version_major: '1',
    version_minor: '0',
    content_sha256: tenant.contentSha256,
    consent_text_id: 'consent-v1',
    signer_type: 'individual',
    signed_at: '2026-10-15T09:00:01.234Z',
    source_repository: 'org-1/repo',
    source_pr_number: '7',
    state: 'active',
    revoked_at: '',
    revoked_by_github_id: '',
    revoke_reason_code: '',
    pii_erased: 'false',
  });
  expect(revoked).toMatchObject({
    signed_at: '2026-10-15T09:00:02.000Z',
    source_repository: '',
    source_pr_number: '',
    state: 'revoked',
    revoked_at: '2026-10-15T09:00:02.500Z',
    revoked_by_github_id: '53',
    revoke_reason_code: 'maintainer_decision',
  });
});

test('the export appends one signatures.exported row with the document, the state and the count, and no name or email', async () => {
  const { db, tenant, scope } = await world();
  await seedSignatures(db, tenant, [
    { githubId: 61 },
    { githubId: 62 },
    { githubId: 63, revoked: { afterMs: 1, byGithubId: 61, reason: 'other' } },
  ]);
  const run = await runExport(db, scope, { documentId: tenant.documentId, state: 'revoked' });
  expect(run.rowCount).toBe(1);
  const rows = await db.selectFrom('audit_log').selectAll().where('action', '=', 'signatures.exported').execute();
  expect(rows).toEqual([
    expect.objectContaining({
      installation_id: tenant.installationId,
      actor_github_id: 41_898_282,
      subject_type: 'document',
      subject_id: tenant.documentId,
      metadata: { state: 'revoked', row_count: 1 },
    }),
  ]);
});

test('an export of an empty selection is recorded too, with a row count of zero', async () => {
  const { db, tenant, scope } = await world();
  await runExport(db, scope, { documentId: tenant.documentId, state: 'outdated' });
  const rows = await db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'signatures.exported')
    .execute();
  expect(rows).toEqual([{ metadata: { state: 'outdated', row_count: 0 } }]);
});
