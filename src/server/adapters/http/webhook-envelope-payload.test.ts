// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AppError } from './errors.ts';
import { readEnvelope } from './webhook-envelope.ts';

const HEADERS = {
  'content-type': 'application/json',
  'x-github-event': 'pull_request',
  'x-github-delivery': '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c',
};

function payloadOf(body: Buffer | string): Record<string, unknown> {
  return readEnvelope(HEADERS, Buffer.from(body), undefined).payload;
}

/** The failure of the payload step, or `undefined` when the body is an acceptable object. */
function refusal(body: Buffer | string): AppError | undefined {
  try {
    payloadOf(body);
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

const BAD_BODIES = [
  { label: 'an empty body', body: '' },
  { label: 'a bare word', body: 'opened' },
  { label: 'a truncated object', body: '{"action":"opened"' },
  { label: 'a trailing comma', body: '{"action":"opened",}' },
  { label: 'single quotes', body: "{'action':'opened'}" },
  { label: 'two objects', body: '{}{}' },
  { label: 'text after the object', body: '{} x' },
  { label: 'a top-level array', body: '[{"action":"opened"}]' },
  { label: 'a top-level empty array', body: '[]' },
  { label: 'a top-level null', body: 'null' },
  { label: 'a top-level number', body: '42' },
  { label: 'a top-level string', body: '"{}"' },
  { label: 'a top-level true', body: 'true' },
  { label: 'a byte order mark before the object', body: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{}')]) },
  { label: 'a UTF-16 byte order mark', body: Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00]) },
  { label: 'a byte that is not UTF-8', body: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]) },
  { label: 'a truncated multi-byte sequence', body: Buffer.from([0x7b, 0x7d, 0xe2, 0x82]) },
  { label: 'an overlong encoding', body: Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x3a, 0x31, 0x7d]) },
  {
    label: 'a lone surrogate encoded as UTF-8',
    body: Buffer.from([0x7b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x3a, 0x31, 0x7d]),
  },
  { label: 'a NUL byte inside a string', body: Buffer.from([0x7b, 0x22, 0x61, 0x00, 0x22, 0x3a, 0x31, 0x7d]) },
  { label: 'a NUL byte after the object', body: Buffer.from([0x7b, 0x7d, 0x00]) },
  { label: 'a raw newline inside a string', body: '{"a":"x\ny"}' },
  { label: 'a bad escape', body: '{"a":"\\x"}' },
  { label: 'a lone surrogate escape that is cut short', body: '{"a":"\\ud8' },
  { label: 'a million opening brackets', body: '['.repeat(1_048_576) },
  { label: 'a million opening braces', body: '{"a":'.repeat(200_000) },
];

test.each(BAD_BODIES)('$label is a 400 webhook_payload_invalid that quotes nothing', ({ body }) => {
  const failure = refusal(body);
  expect(failure).toMatchObject({ status: 400, code: 'webhook_payload_invalid' });
  expect(failure?.details).toBeUndefined();
  expect(failure?.message).toBe('webhook_payload_invalid');
  expect(failure?.cause).toBeUndefined();
});

test.each([
  { label: 'an empty object', body: '{}', expected: {} },
  { label: 'whitespace around the object', body: ' \r\n\t{"a":1}\n ', expected: { a: 1 } },
  { label: 'multi-byte text', body: '{"a":"Zażółć \u{1F600}"}', expected: { a: 'Zażółć \u{1F600}' } },
  { label: 'an escaped NUL', body: '{"a":"\\u0000"}', expected: { a: '\u0000' } },
  { label: 'a nested array', body: '{"a":[[1],[2]]}', expected: { a: [[1], [2]] } },
  { label: 'a repeated key, where the last wins as in JSON.parse', body: '{"a":1,"a":2}', expected: { a: 2 } },
])('$label is accepted as an object', ({ body, expected }) => {
  expect(payloadOf(body)).toEqual(expected);
});

test('a __proto__ key stays an own property of the parsed object and pollutes nothing', () => {
  const payload = payloadOf('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  expect(Object.hasOwn(payload, '__proto__')).toBe(true);
  expect(Reflect.getPrototypeOf(payload)).toBe(Reflect.getPrototypeOf({}));
  expect('polluted' in {}).toBe(false);
});
