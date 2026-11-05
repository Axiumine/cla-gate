// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { metadataText } from './metadata-text.ts';

/** U+202E, the right-to-left override, and U+FEFF, the byte-order mark, from their code points: written out they would act in this file. */
const RLO = String.fromCodePoint(0x202e);
const BOM = String.fromCodePoint(0xfeff);

// E18-S09: the metadata of an audit row as text for a `<pre>`: indented JSON with the keys sorted at every level, strings quoted and
// escaped, and the characters that change how text is drawn written out.

test('keys are sorted, whatever order the object came in', () => {
  expect(metadataText({ signature_id: 9, count: 2, reason_code: 'legal_request' })).toBe(
    '{\n  "count": 2,\n  "reason_code": "legal_request",\n  "signature_id": 9\n}',
  );
});

test('the same object in another key order is the same text', () => {
  expect(metadataText({ b: 1, a: 2 })).toBe(metadataText({ a: 2, b: 1 }));
});

test('keys are sorted at every level, and a list keeps its order', () => {
  expect(metadataText({ outer: { z: [3, 1, { y: 1, x: 2 }], a: null }, flag: true })).toBe(
    [
      '{',
      '  "flag": true,',
      '  "outer": {',
      '    "a": null,',
      '    "z": [',
      '      3,',
      '      1,',
      '      {',
      '        "x": 2,',
      '        "y": 1',
      '      }',
      '    ]',
      '  }',
      '}',
    ].join('\n'),
  );
});

test('an empty object, an empty list and an empty object inside are written short', () => {
  expect(metadataText({})).toBe('{}');
  expect(metadataText({ ids: [], inner: {} })).toBe('{\n  "ids": [],\n  "inner": {}\n}');
});

test('keys are ordered by their code units, not by the language of the reader', () => {
  expect(metadataText({ b: 1, B: 2, ä: 3, a: 4 })).toBe('{\n  "B": 2,\n  "a": 4,\n  "b": 1,\n  "ä": 3\n}');
});

test('markup in a value stays the characters it is made of, inside a quoted string', () => {
  expect(metadataText({ scope: '<script>alert(1)</script>' })).toBe('{\n  "scope": "<script>alert(1)</script>"\n}');
});

test('a quote, a backslash and a line break in a value are escaped, so a value cannot look like the structure around it', () => {
  expect(metadataText({ kind: 'a"},{"b":1,\n\\' })).toBe('{\n  "kind": "a\\"},{\\"b\\":1,\\n\\\\"\n}');
});

test('a right-to-left override and a byte-order mark are written out instead of acting', () => {
  expect(metadataText({ kind: `a${RLO}b${BOM}c` })).toBe('{\n  "kind": "a<U+202E>b<U+FEFF>c"\n}');
  expect(metadataText({ [`k${RLO}y`]: 1 })).toBe('{\n  "k<U+202E>y": 1\n}');
});

test('a key called __proto__ is a key like any other and is not lost', () => {
  const parsed: unknown = JSON.parse('{"__proto__": 1, "a": 2}');
  expect(
    typeof parsed === 'object' && parsed !== null ? metadataText(Object.fromEntries(Object.entries(parsed))) : '',
  ).toBe('{\n  "__proto__": 1,\n  "a": 2\n}');
});

test('a value of 10,000 characters is kept whole', () => {
  const text = metadataText({ kind: 'x'.repeat(10_000) });
  expect(text).toBe(`{\n  "kind": "${'x'.repeat(10_000)}"\n}`);
});
