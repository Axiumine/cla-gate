// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { contentHashOf, sha256Hex } from './text-hash.ts';

// E18-S05: the fingerprint the browser shows before a publish is the one the server records: SHA-256 over the UTF-8 bytes of the
// canonical text. The expected values were made with `sha256sum` over the same bytes, outside this code.

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['Caffè — 日本語 😀', 'ab10bb293555ee324d2e1273e3b260e9c11f312b65061dc2ffa26dc1b9c3badc'],
  ['line one\nline two\n', 'e9024f1a07d29d52ad3aa5e1a18e94db1f3a9fd32b89e39d47c472cd99071e13'],
])('the hash of %j is the SHA-256 of its UTF-8 bytes', async (text, expected) => {
  expect(await sha256Hex(text)).toBe(expected);
});

test('the hash of a text is the hash of its canonical form: one line feed at the end, and line ends as line feeds', async () => {
  expect(await contentHashOf('abc')).toBe('edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
  expect(await contentHashOf('abc\n\n\n')).toBe(await contentHashOf('abc'));
  expect(await contentHashOf('a\r\nb')).toBe('911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2');
});

test('a browser without crypto.subtle (a page that is not a secure context) rejects, for the caller to say so', async () => {
  vi.stubGlobal('crypto', {});
  await expect(sha256Hex('abc')).rejects.toBeInstanceOf(TypeError);
});
