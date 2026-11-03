// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGNATURE_STATES, signatureState } from './signature-state.ts';

// The state of a signature (E13-S06): the table of its three branches and the document that has no active version.

test.each([
  ['not revoked, the active major', 'active', { revoked: false, major: 2 }, 2],
  ['not revoked, a higher major than the active one', 'active', { revoked: false, major: 3 }, 2],
  ['not revoked, a lower major than the active one', 'outdated', { revoked: false, major: 1 }, 2],
  ['not revoked, a document with no active version', 'active', { revoked: false, major: 1 }, null],
  ['revoked, the active major', 'revoked', { revoked: true, major: 2 }, 2],
  ['revoked, a lower major', 'revoked', { revoked: true, major: 1 }, 2],
  ['revoked, a document with no active version', 'revoked', { revoked: true, major: 1 }, null],
] as const)('%s is %s', (_name, state, facts, activeMajor) => {
  expect(signatureState(facts, activeMajor)).toBe(state);
});

test('the states are the three the export and the lists name', () => {
  expect(SIGNATURE_STATES).toEqual(['active', 'outdated', 'revoked']);
});
