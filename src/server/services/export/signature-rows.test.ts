// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { SIGNATURE_CSV_COLUMNS } from '../../../shared/signature-export.ts';
import { csvRecords } from '../../domain/csv-fixture/test-support.ts';
import type { SignatureBatchRow } from './signature-queries.ts';
import { csvRowOf, HEADER_ROW } from './signature-rows.ts';

// One signature as one line (E16-S03), on rows made by hand: which cell holds what, and what an absent value looks like.

const ROW: SignatureBatchRow = {
  signature_id: 11,
  github_user_id: 4242,
  pii_login: 'ada',
  pii_name: 'Ada Lovelace',
  pii_email: 'ada@example.test',
  document_id: 3,
  document_name: 'Individual CLA',
  version_major: 2,
  version_minor: 1,
  content_sha256: 'ab'.repeat(32),
  consent_text_id: 'consent-v2',
  signer_type: 'individual',
  signed_at: new Date('2026-10-15T09:30:00.123Z'),
  source_repository: 'org/repo',
  source_pr_number: 9,
  revoked_at: null,
  revoked_by_github_id: null,
  revoke_reason: null,
  active_major: 2,
  pii_erased: false,
};

/** The cells of the line of `row`, by column name. */
const cellsOf = (row: SignatureBatchRow): Record<string, string> =>
  z.record(z.string(), z.string()).parse(csvRecords(`${HEADER_ROW}${csvRowOf(row)}`).at(0));

test('the header row is the column names, comma separated, with a CRLF', () => {
  expect(HEADER_ROW).toBe(`${SIGNATURE_CSV_COLUMNS.join(',')}\r\n`);
});

test('a signature that is active fills every column that has a value and leaves the revocation columns empty', () => {
  expect(cellsOf(ROW)).toEqual({
    signature_id: '11',
    github_user_id: '4242',
    login: 'ada',
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    document_id: '3',
    document_name: 'Individual CLA',
    version_major: '2',
    version_minor: '1',
    content_sha256: 'ab'.repeat(32),
    consent_text_id: 'consent-v2',
    signer_type: 'individual',
    signed_at: '2026-10-15T09:30:00.123Z',
    source_repository: 'org/repo',
    source_pr_number: '9',
    state: 'active',
    revoked_at: '',
    revoked_by_github_id: '',
    revoke_reason_code: '',
    pii_erased: 'false',
  });
});

test.each([
  ['a lower major than the active one is outdated', { ...ROW, version_major: 1 }, 'state', 'outdated'],
  ['a document with no active version is active', { ...ROW, active_major: null }, 'state', 'active'],
  [
    'a signature made from no repository has no source',
    { ...ROW, source_repository: null, source_pr_number: null },
    'source_pr_number',
    '',
  ],
  [
    'an erased signature has no login',
    { ...ROW, pii_login: null, pii_name: null, pii_email: null, pii_erased: true },
    'login',
    '',
  ],
  [
    'an erased signature has no name',
    { ...ROW, pii_login: null, pii_name: null, pii_email: null, pii_erased: true },
    'name',
    '',
  ],
  [
    'an erased signature has no email',
    { ...ROW, pii_login: null, pii_name: null, pii_email: null, pii_erased: true },
    'email',
    '',
  ],
  [
    'an erased signature says so',
    { ...ROW, pii_login: null, pii_name: null, pii_email: null, pii_erased: true },
    'pii_erased',
    'true',
  ],
] as const)('%s', (_name, row, column, value) => {
  expect(cellsOf(row)).toMatchObject({ [column]: value });
});

test('a revoked signature carries the instant, the person and the reason code, and is revoked whatever its major', () => {
  const revoked = {
    ...ROW,
    version_major: 1,
    revoked_at: new Date('2026-10-16T00:00:00.000Z'),
    revoked_by_github_id: 77,
    revoke_reason: 'legal_request',
  } as const;
  expect(cellsOf(revoked)).toMatchObject({
    state: 'revoked',
    revoked_at: '2026-10-16T00:00:00.000Z',
    revoked_by_github_id: '77',
    revoke_reason_code: 'legal_request',
  });
});

test('a name that starts a formula is guarded in its cell and every other cell is left as it was', () => {
  const cells = cellsOf({ ...ROW, pii_name: '=HYPERLINK("http://evil.example","x")', document_name: '@SUM(A1)' });
  expect(cells['name']).toBe('\'=HYPERLINK("http://evil.example","x")');
  expect(cells['document_name']).toBe("'@SUM(A1)");
  expect(cells['login']).toBe('ada');
});
