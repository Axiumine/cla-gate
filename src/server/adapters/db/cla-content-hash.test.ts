// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { prepareClaText, sha256Hex } from '../../services/cla-content.ts';
import { migratedTestDatabase, seedTenant } from './test-support.ts';

// The hash of the server and the database agree (E12-S02): `cla_versions.content_sha256` must equal
// `encode(sha256(convert_to(content_md, 'UTF8')), 'hex')`, so the database itself verifies `sha256Hex` over the texts whose
// bytes are the hardest to get alike: emoji, CJK, combining marks, right-to-left text and the maximum size.

const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const TEXTS: (readonly [label: string, raw: string])[] = [
  ['ASCII', 'I agree to the terms.\n'],
  [
    'emoji and a flag, which are four-byte characters',
    `${at(0x1f600)} ${at(0x1f1ee, 0x1f1f9)} ${at(0x1f469, 0x200d, 0x1f4bb)}\n`,
  ],
  ['CJK and Hangul', `${at(0x4e2d, 0x6587)} ${at(0xd55c, 0xae00)} ${at(0x3042, 0x3044)}\n`],
  ['a letter with combining marks, not normalised', `e${at(0x301, 0x323, 0x302)} a${at(0x308)}\n`],
  ['a composed letter next to the same one decomposed', `${at(0xe9)} e${at(0x301)}\n`],
  ['right-to-left text', `${at(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${at(0x645, 0x631, 0x62d, 0x628, 0x627)}\n`],
  ['variation selectors and a zero width joiner', `${at(0x2764, 0xfe0f)} a${at(0x200d)}b\n`],
  ['a byte order mark inside the text', `a${at(0xfeff)}b\n`],
  ['a line separator and a no-break space', `a${at(0x2028)}b${at(0xa0)}c\n`],
  ['text typed with CRLF line endings and a byte order mark', `${at(0xfeff)}One  \r\nTwo\t\r\n\r\n`],
  ['the maximum size of four-byte characters', `${at(0x1f600).repeat(51_199)}${'a'.repeat(3)}\n`],
];

const hashes = z.object({ stored: z.string(), computed: z.string(), text: z.string() });

test.each(TEXTS)(
  'the database accepts the hash of the server for %s, and computes the same one',
  async (_label, raw) => {
    const { db } = await migratedTestDatabase();
    const tenant = await seedTenant(db);
    const prepared = prepareClaText(raw);
    const inserted = await db
      .insertInto('cla_versions')
      .values({
        document_id: tenant.documentId,
        major: 2,
        minor: 0,
        content_md: prepared.contentMd,
        content_sha256: prepared.contentSha256,
        published_by: tenant.publisherId,
        rationale: 'r',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const row = await sql`select content_sha256 as stored, content_md as text,
    encode(sha256(convert_to(content_md, 'UTF8')), 'hex') as computed
    from cla_versions where id = ${inserted.id}`.execute(db);
    const read = hashes.parse(row.rows[0]);
    expect(read.text).toBe(prepared.contentMd);
    expect(read.stored).toBe(sha256Hex(prepared.contentMd));
    expect(read.computed).toBe(read.stored);
  },
);

test('the database hashes the exact bytes: the hash of a text in another Unicode form is refused', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const decomposed = prepareClaText(`cafe${at(0x301)}`);
  const composed = prepareClaText(`caf${at(0xe9)}`);
  expect(decomposed.contentSha256).not.toBe(composed.contentSha256);
  const wrong = db.insertInto('cla_versions').values({
    document_id: tenant.documentId,
    major: 2,
    minor: 0,
    content_md: decomposed.contentMd,
    content_sha256: composed.contentSha256,
    published_by: tenant.publisherId,
    rationale: 'r',
  });
  await expect(wrong.execute()).rejects.toMatchObject({ code: '23514' });
});
