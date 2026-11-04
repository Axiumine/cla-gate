// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from './hostile-names.ts';
import {
  SIGNER_EMAIL_MAX_LENGTH,
  SIGNER_NAME_MAX_CODE_POINTS,
  SIGNER_RULE_STATUS,
  signerInputSchema,
} from './signer-input.ts';

// The two inputs of the consent form (E13-S03): the typed name is cleaned and bounded, the address is only text until the
// server checks it against the verified list. The corpus of hostile names is the shared one (E09-S01), not a list of this file.

const EMAIL = 'ada@example.org';
const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

/** What the schema makes of `name`, with a fixed address. */
const parseName = (name: string) => signerInputSchema.safeParse({ name, email: EMAIL });

/** The cleaned name, or a failure that names the input as the one that broke. */
function nameOf(raw: string): string {
  const result = parseName(raw);
  if (!result.success) {
    throw new Error(`the name was refused: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data.name;
}

/** The issues of a refused name as the tests compare them. */
function issuesOf(
  raw: string,
): readonly { code: string; path: readonly PropertyKey[]; message: string; params: unknown }[] {
  const result = parseName(raw);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
        params: issue.code === 'custom' ? issue.params : undefined,
      }));
}

const INVALID_NAME = [{ code: 'custom', path: ['name'], message: 'invalid_name', params: { code: 'invalid_name' } }];

test('the limits are 200 code points for a name and 254 characters for an address', () => {
  expect(SIGNER_NAME_MAX_CODE_POINTS).toBe(200);
  expect(SIGNER_EMAIL_MAX_LENGTH).toBe(254);
});

test('every rule is answered 422, and the codes are those of the story', () => {
  expect(SIGNER_RULE_STATUS).toStrictEqual({ invalid_name: 422, email_not_verified: 422, no_verified_email: 422 });
});

test.each([
  ['a plain name', 'Ada Lovelace', 'Ada Lovelace'],
  ['spaces at both ends', '   Ada Lovelace  ', 'Ada Lovelace'],
  ['a run of spaces inside', 'Ada      Lovelace', 'Ada Lovelace'],
  ['a no-break space, an em space and an ideographic space', `A${at(0xa0)}${at(0x2003)}${at(0x3000)}B`, 'A B'],
  ['a byte order mark at the start', `${at(0xfeff)}Ada`, 'Ada'],
  ['a decomposed e with an acute accent', `Caf${at(0x65, 0x301)}`, `Caf${at(0xe9)}`],
  ['a name already in NFC', `Caf${at(0xe9)}`, `Caf${at(0xe9)}`],
  ['a Hangul syllable written as jamo', at(0x1112, 0x1161, 0x11ab), at(0xd55c)],
  ['one code point', 'x', 'x'],
])('%s is cleaned: %j', (_label, raw, kept) => {
  expect(nameOf(raw)).toBe(kept);
});

test.each([
  ['nothing', '', 0],
  ['one code point', 'x', 1],
  ['200 code points', 'x'.repeat(200), 200],
  ['201 code points', 'x'.repeat(201), 201],
  ['200 astral characters of two UTF-16 units each', at(0x1f600).repeat(200), 200],
  ['201 astral characters', at(0x1f600).repeat(201), 201],
  ['one astral character', at(0x1f600), 1],
  ['white space only', ` ${at(0xa0)}${at(0x2003)} `, 0],
  ['a name of ten thousand characters', 'x'.repeat(10_000), 10_000],
])('the length of %s is counted in code points after cleaning', (_label, raw, codePoints) => {
  expect(Array.from(raw.trim())).toHaveLength(codePoints);
  const accepted = codePoints >= 1 && codePoints <= 200;
  expect(parseName(raw).success).toBe(accepted);
  expect(issuesOf(raw)).toStrictEqual(accepted ? [] : INVALID_NAME);
});

test('a name over 200 code points only because of white space is kept once the white space is collapsed', () => {
  const raw = `${'x'.repeat(100)}${' '.repeat(120)}${'y'.repeat(99)}`;
  expect(raw.length).toBeGreaterThan(200);
  expect(nameOf(raw)).toBe(`${'x'.repeat(100)} ${'y'.repeat(99)}`);
  expect(parseName(`${'x'.repeat(100)} ${'y'.repeat(100)}`).success).toBe(false);
});

test.each([
  ['a NUL', 0x00],
  ['a tab', 0x09],
  ['a line feed', 0x0a],
  ['a carriage return', 0x0d],
  ['the escape control', 0x1b],
  ['DEL', 0x7f],
  ['a C1 control', 0x85],
  ['the last C1 control', 0x9f],
  ['the line separator', 0x2028],
  ['the paragraph separator', 0x2029],
  ['a left-to-right embedding', 0x202a],
  ['a right-to-left embedding', 0x202b],
  ['the end of an embedding', 0x202c],
  ['a left-to-right override', 0x202d],
  ['a right-to-left override', 0x202e],
  ['a left-to-right isolate', 0x2066],
  ['a right-to-left isolate', 0x2067],
  ['a first strong isolate', 0x2068],
  ['a pop directional isolate', 0x2069],
])('a name with %s is refused with the issue code invalid_name', (_label, codePoint) => {
  for (const raw of [`Ada${at(codePoint)}Lovelace`, `${at(codePoint)}Ada`, `Ada${at(codePoint)}`]) {
    expect(issuesOf(raw)).toStrictEqual(INVALID_NAME);
  }
});

test.each([
  ['a lone high surrogate', 'a\ud800b'],
  ['a lone low surrogate', 'a\udc00b'],
  ['a lone surrogate alone', '\ud800'],
])('%s is refused with the issue code invalid_name, as the database cannot keep it', (_label, raw) => {
  expect(issuesOf(raw)).toStrictEqual(INVALID_NAME);
});

test.each([
  ['a zero width space', 0x200b],
  ['a zero width joiner', 0x200d],
  ['a zero width non-joiner', 0x200c],
  ['a left-to-right mark', 0x200e],
  ['a right-to-left mark', 0x200f],
  ['an Arabic letter mark', 0x61c],
  ['a word joiner', 0x2060],
  ['a soft hyphen', 0xad],
  ['a variation selector', 0xfe0f],
  ['a tag character', 0xe0041],
  ['a private use character', 0xe000],
  ['the replacement character', 0xfffd],
])('nothing else is refused: %s stays in the name', (_label, codePoint) => {
  const raw = `Ada${at(codePoint)}Lovelace`;
  expect(nameOf(raw)).toBe(raw);
});

test.each(HOSTILE_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'the hostile name %j parses to the same string',
  (_label, name) => {
    expect(nameOf(name)).toBe(name);
  },
);

test.each(HOSTILE_CONTROL_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'the hostile control name %j is refused with the issue code invalid_name',
  (_label, name) => {
    expect(issuesOf(name)).toStrictEqual(INVALID_NAME);
  },
);

test('the hostile names with spaces around them and more spaces inside change only by trimming and collapsing', () => {
  for (const name of HOSTILE_NAMES) {
    const padded = ` ${at(0xa0)}${name.replaceAll(' ', '   ')}  `;
    expect(nameOf(padded)).toBe(nameOf(name));
  }
});

test('cleaning is idempotent: a cleaned name cleans to itself', () => {
  for (const sample of ['  a   b ', `Caf${at(0x65, 0x301)}`, at(0x1f600).repeat(200), ...HOSTILE_NAMES]) {
    expect(nameOf(nameOf(sample))).toBe(nameOf(sample));
  }
});

test('the address is any text and is passed on as it was typed, for the server to check against the verified list', () => {
  const address = ' ADA@Example.org ';
  const result = signerInputSchema.parse({ name: 'Ada', email: address });
  expect(result).toStrictEqual({ name: 'Ada', email: address });
  const tooLong = `${'a'.repeat(SIGNER_EMAIL_MAX_LENGTH)}@example.org`;
  expect(signerInputSchema.parse({ name: 'Ada', email: tooLong }).email).toBe(tooLong);
  expect(signerInputSchema.parse({ name: 'Ada', email: '' }).email).toBe('');
});

test.each([
  ['no name', { email: EMAIL }, 'invalid_type'],
  ['no address', { name: 'Ada' }, 'invalid_type'],
  ['a name that is not text', { name: 1, email: EMAIL }, 'invalid_type'],
  ['an address that is not text', { name: 'Ada', email: ['x'] }, 'invalid_type'],
  ['a key nobody defined', { name: 'Ada', email: EMAIL, login: 'ada' }, 'unrecognized_keys'],
])('%s is not an invalid name: the issue is %s', (_label, input, code) => {
  const result = signerInputSchema.safeParse(input);
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.code)).toStrictEqual([code]);
});

test('a refused name leaves no part of the name or the address in the issues', () => {
  const result = signerInputSchema.safeParse({ name: `zzzz-name${at(0x202e)}`, email: 'zzzz-address@example.org' });
  expect(result.success).toBe(false);
  expect(JSON.stringify(result.error?.issues)).not.toContain('zzzz');
  expect(JSON.stringify(result.error?.issues)).toContain('invalid_name');
});
