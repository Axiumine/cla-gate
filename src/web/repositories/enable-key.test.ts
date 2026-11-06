// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { enableKey } from './enable-key.ts';
import { claOf, gadgets } from './test-support.ts';

// E18-S10: the key of the Enable button of a row. It changes when the document of the repository does, or the version of it in force, so a
// refusal that said "attach a CLA" does not outlive the attaching.

const keyOf = (document: ReturnType<typeof claOf> | null) => enableKey(gadgets({ document }));

test('a repository with no document has one key, the same on every visit', () => {
  expect(keyOf(null)).toBe(keyOf(null));
});

test('another document, another version and a version that is not published yet are each another key', () => {
  const keys = [
    keyOf(null),
    keyOf(claOf()),
    keyOf(claOf({ id: 12 })),
    keyOf(claOf({ activeVersion: { major: 1, minor: 1 } })),
    keyOf(claOf({ activeVersion: { major: 2, minor: 0 } })),
    keyOf(claOf({ activeVersion: null })),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(keyOf(claOf())).toBe(keyOf(claOf({ name: 'Renamed' })));
});
