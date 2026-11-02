// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commentBody, hasPreserve, hasReason, hasReasonAfterPreserve, MIN_REASON_LENGTH, reasonOf } from './reason.ts';

test('the shortest reason is ten characters, the same number the ESLint ban-ts-comment option uses', () => {
  expect(MIN_REASON_LENGTH).toBe(10);
});

test.each([
  ['a line comment', '// hello world', 'hello world'],
  ['a block comment', '/* hello world */', 'hello world'],
  ['a JSDoc comment', '/** hello world */', 'hello world'],
  ['a block comment over several lines', '/*\n * first line\n * second   line\n */', 'first line second line'],
  ['extra whitespace', '//   spaced \t out  ', 'spaced out'],
  ['an empty line comment', '//', ''],
])('commentBody of %s', (_what, raw, body) => {
  expect(commentBody(raw)).toBe(body);
});

test.each([
  ['no separator', 'just words here', undefined],
  ['a separator in the middle', 'eslint-disable-line x -- the reason', 'the reason'],
  ['a separator at the start', '-- the reason', 'the reason'],
  ['a separator at the end', 'something --', ''],
  ['the first separator wins', 'a -- b -- c', 'b -- c'],
  ['a longer run of dashes', 'a ---- the reason', 'the reason'],
  ['a dash pair glued to a word', 'a --b', undefined],
  ['a dash pair glued to the word before it', 'a-- b', undefined],
  ['a single dash', 'a - b', undefined],
])('reasonOf: %s', (_what, body, reason) => {
  expect(reasonOf(body)).toBe(reason);
});

test.each([
  ['no separator', 'a very long comment without any separator', false],
  ['nothing after the separator', 'x --', false],
  ['nine characters', 'x -- 123456789', false],
  ['ten characters', 'x -- 1234567890', true],
  ['ten characters with inner spaces', 'x -- ab cd ef g', true],
  ['a long reason', 'x -- foreign payloads are untyped by contract', true],
])('hasReason: %s', (_what, body, expected) => {
  expect(hasReason(body)).toBe(expected);
});

test.each([
  ['the marker', 'v8 ignore next -- @preserve', true],
  ['the marker and a reason', 'v8 ignore next -- @preserve unreachable by construction', true],
  ['no marker', 'v8 ignore next', false],
  ['a marker without the separator', 'v8 ignore next @preserve', false],
  ['a longer word that starts like the marker', 'v8 ignore next -- @preserved', false],
  ['a hyphenated word that starts like the marker', 'v8 ignore next -- @preserve-all', false],
])('hasPreserve: %s', (_what, body, expected) => {
  expect(hasPreserve(body)).toBe(expected);
});

test.each([
  ['no marker', 'v8 ignore next unreachable by construction', false],
  ['the marker alone', 'v8 ignore next -- @preserve', false],
  ['the marker and a short reason', 'v8 ignore next -- @preserve too short', false],
  ['the marker and a reason', 'v8 ignore next -- @preserve unreachable by construction', true],
  ['a reason behind a colon', 'v8 ignore next -- @preserve: unreachable by construction', true],
  ['a colon and nothing else', 'v8 ignore next -- @preserve: ----------', false],
  ['exactly ten characters', 'v8 ignore next -- @preserve 1234567890', true],
])('hasReasonAfterPreserve: %s', (_what, body, expected) => {
  expect(hasReasonAfterPreserve(body)).toBe(expected);
});
