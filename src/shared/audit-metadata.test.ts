// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import type { AUDIT_METADATA_KEYS } from './audit.ts';
import { AUDIT_METADATA_MAX_BYTES, type AuditMetadata, auditMetadataSchema } from './audit-metadata.ts';
import { METADATA_CASES } from './test-support.ts';

test.each(METADATA_CASES)('the schema judges %s', (_name, metadata, accepted) => {
  expect(auditMetadataSchema.safeParse(metadata).success).toBe(accepted);
});

test('the output is a fresh object with the same members', () => {
  const input = { count: 3, rows: [1, 2], state: 'open' };
  const output = auditMetadataSchema.parse(input);
  expect(output).toEqual(input);
  expect(output).not.toBe(input);
});

test('an own __proto__ key is an unrecognised key, not something to drop silently', () => {
  const hostile: unknown = JSON.parse('{"__proto__":{"email":"a@b.c"},"count":1}');
  expect(auditMetadataSchema.safeParse(hostile).success).toBe(false);
});

test('an inherited member is not part of the serialised output of a plain copy', () => {
  const inherited: unknown = Object.create({ count: 1 });
  expect(JSON.stringify(auditMetadataSchema.parse(inherited))).toBe('{"count":1}');
});

/** Integers that serialise to a JSON array `length` characters long, brackets included (`length` of at least 3). */
function integersFillingArray(length: number): number[] {
  const count = Math.ceil((length - 1) / 17);
  const digits = length - 2 - (count - 1);
  return Array.from({ length: count }, (_, index) => {
    const share = Math.floor(digits / count) + (index < digits % count ? 1 : 0);
    return Number('1'.repeat(share));
  });
}

/** Metadata whose JSON text is exactly `bytes` long: two lists of integers share what the keys leave over. */
function metadataOfBytes(bytes: number): AuditMetadata {
  const frame = JSON.stringify({ rows: [], sessions: [] }).length - 4;
  const inner = bytes - frame;
  const first = Math.min(1700, inner - 3);
  const metadata = { rows: integersFillingArray(first), sessions: integersFillingArray(inner - first) };
  expect(JSON.stringify(metadata)).toHaveLength(bytes);
  return metadata;
}

test.each([
  [AUDIT_METADATA_MAX_BYTES - 1, true],
  [AUDIT_METADATA_MAX_BYTES, true],
  [AUDIT_METADATA_MAX_BYTES + 1, false],
])('metadata of %d bytes is accepted: %s', (bytes, accepted) => {
  expect(auditMetadataSchema.safeParse(metadataOfBytes(bytes)).success).toBe(accepted);
});

test('the byte cap is 2,048 and the refusal says so without repeating the metadata', () => {
  expect(AUDIT_METADATA_MAX_BYTES).toBe(2048);
  const result = auditMetadataSchema.safeParse(metadataOfBytes(2049));
  expect(result.error?.issues.map((issue) => issue.message)).toEqual(['audit metadata is longer than 2048 bytes']);
});

test('callers can only write closed keys with closed values', () => {
  expectTypeOf<keyof AuditMetadata>().toEqualTypeOf<(typeof AUDIT_METADATA_KEYS)[number]>();
  expectTypeOf<Exclude<AuditMetadata['rows'], undefined>>().toEqualTypeOf<
    number | boolean | null | number[] | string
  >();
});
