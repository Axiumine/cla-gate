// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLA_TEXT_MAX_BYTES } from '../../shared/cla-text.ts';
import { indentedBullets, MOST_LINEAR_SLOWDOWN, nestedQuotes, slowdownOf } from '../../shared/test-support.ts';
import { prepareClaText, sha256Hex } from './cla-content.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The hash and the preparation of the text of a CLA (E12-S02). The reference digests were computed with `sha256sum` over the
// bytes named in each case, not with the code under test.

const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

test.each([
  ['ASCII', 'Hello\n', '66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18'],
  [
    'a composed letter, an emoji and a CJK character, as their UTF-8 bytes',
    `caf${at(0xe9)} ${at(0x1f600)} ${at(0x4e2d)}\n`,
    '25e0ad100547aaf83f9091ed94b4d13be6931003019bbb21d0a327ef755dc09a',
  ],
  [
    'a decomposed letter, which is other bytes than the composed one',
    `cafe${at(0x301)}\n`,
    'dcc492420fc77018ce8b7eb59458568e7901e9751194f4dbe7a1044ca16ccd2e',
  ],
  ['a composed letter', `caf${at(0xe9)}\n`, '7b49b9e063bd91a4f9252b413261f5557b9c570aa61516989499f64a62dbcdd6'],
])('sha256Hex hashes the UTF-8 bytes of %s', (_label, text, digest) => {
  expect(sha256Hex(text)).toBe(digest);
});

test('two texts that differ only in a lone surrogate would hash alike, which is why validation refuses a lone surrogate', () => {
  expect(sha256Hex(`a${at(0xd800)}\n`)).toBe(sha256Hex(`a${at(0xdc00)}\n`));
  expect(refusal(`a${at(0xd800)}`).rule).toBe('content_invalid_characters');
  expect(refusal(`a${at(0xdc00)}`).rule).toBe('content_invalid_characters');
});

test('the same wording with LF, CRLF or CR line endings, a byte order mark or extra final newlines has one text and one hash', () => {
  const variants = ['Hello\n', 'Hello', 'Hello\r\n', 'Hello\r', '﻿Hello\r\n', 'Hello\n\n\n', 'Hello\r\n\r\n'];
  const prepared = variants.map(prepareClaText);
  expect(new Set(prepared.map((one) => one.contentMd))).toEqual(new Set(['Hello\n']));
  expect(new Set(prepared.map((one) => one.contentSha256))).toEqual(
    new Set(['66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18']),
  );
});

test('lines are not rewritten: the hash covers the Markdown line breaks and the blank lines the maintainer wrote', () => {
  const kept = prepareClaText('One  \r\nTwo\r\n\r\n\r\nThree\r\n');
  expect(kept.contentMd).toBe('One  \nTwo\n\n\nThree\n');
  expect(kept.contentSha256).not.toBe(prepareClaText('One\nTwo\n\nThree\n').contentSha256);
});

function refusal(raw: string): ClaRuleError {
  try {
    prepareClaText(raw);
  } catch (error) {
    if (error instanceof ClaRuleError) {
      return error;
    }
    throw error;
  }
  throw new Error('the text was accepted');
}

test.each([
  ['more than 204 800 bytes', `${'a'.repeat(CLA_TEXT_MAX_BYTES)}\n`, 'content_too_large'],
  ['nothing', '', 'content_empty'],
  ['white space only', ' \r\n\t\r\n', 'content_empty'],
  ['a byte order mark only', '﻿', 'content_empty'],
  ['a NUL', 'a\u0000b', 'content_invalid_characters'],
  ['a lone surrogate', `a${at(0xd800)}`, 'content_invalid_characters'],
  ['block quotes nested 51 levels', nestedQuotes(51), 'content_too_deeply_nested'],
  ['lists nested 51 levels', indentedBullets(51), 'content_too_deeply_nested'],
])('prepareClaText refuses %s as %s', (_label, raw, rule) => {
  expect(refusal(raw).rule).toBe(rule);
});

test('the size is counted on the canonical text: CRLF line endings that become LF can bring a text under the limit', () => {
  const crlf = 'ab\r\n'.repeat(60_000);
  expect(new TextEncoder().encode(crlf).byteLength).toBe(240_000);
  expect(prepareClaText(crlf).contentMd).toBe('ab\n'.repeat(60_000));
});

test('the text of exactly 204 800 bytes is accepted, with its hash, and the next byte is refused with the two numbers', () => {
  const full = `${'a'.repeat(CLA_TEXT_MAX_BYTES - 1)}\n`;
  expect(prepareClaText(full).contentMd).toBe(full);
  const error = refusal(`${'a'.repeat(CLA_TEXT_MAX_BYTES)}\n`);
  expect(error.details).toStrictEqual({ limitBytes: 204_800, actualBytes: 204_801 });
});

test('a refusal never holds the text: not in its message, not in its details', () => {
  const marker = 'MARKER-OF-A-SECRET-TEXT';
  const errors = [
    refusal(`${marker}\u0000`),
    refusal(`${marker}${'a'.repeat(CLA_TEXT_MAX_BYTES)}`),
    refusal(`${marker}${at(0xdc00)}`),
  ];
  for (const error of errors) {
    expect(error.message).toBe(error.rule);
    expect(JSON.stringify(error.details ?? null)).not.toContain(marker);
  }
  expect(errors.map((error) => error.details)).toEqual([
    undefined,
    { limitBytes: 204_800, actualBytes: marker.length + CLA_TEXT_MAX_BYTES + 1 },
    undefined,
  ]);
});

const setextHeadings = (bytes: number): string => 'a\n=\n'.repeat(Math.floor(bytes / 4));

test('a text of 204 796 bytes made of setext headings is prepared in time linear in its size: no parse waits on the request thread', () => {
  const prepared = prepareClaText(setextHeadings(204_796));
  expect(prepared.contentSha256).toBe(sha256Hex(prepared.contentMd));
  expect(prepared.contentMd.length).toBeGreaterThan(204_000);
  expect(slowdownOf(prepareClaText, setextHeadings, 204_796)).toBeLessThan(MOST_LINEAR_SLOWDOWN);
});
