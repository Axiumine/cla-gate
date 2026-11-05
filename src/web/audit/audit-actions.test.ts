// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { createTranslator, messages } from '../i18n/index.ts';
import { actionLabelKey, knownAction } from './audit-actions.ts';

// E18-S09: every action of the audit catalogue has a label, and nothing else is labelled as an action.

const t = createTranslator(messages, 'en');

test.each(AUDIT_ACTIONS)('the action %s has a label in the catalog', (action) => {
  const key = actionLabelKey(action);
  expect(Object.hasOwn(messages, key)).toBe(true);
  expect(t(key).trim()).not.toBe('');
});

test('the label keys are the actions of the catalogue and no others: a label for a retired action is a stale one', () => {
  const labelled = Object.keys(messages)
    .filter((key) => key.startsWith('audit.action.'))
    .map((key) => key.slice('audit.action.'.length))
    .toSorted((a, b) => a.localeCompare(b));
  expect(labelled).toEqual(AUDIT_ACTIONS.toSorted((a, b) => a.localeCompare(b)));
});

test('two actions never have the same label, so the filter and the table tell them apart', () => {
  const labels = AUDIT_ACTIONS.map((action) => t(actionLabelKey(action)));
  expect(new Set(labels).size).toBe(AUDIT_ACTIONS.length);
});

test.each(AUDIT_ACTIONS)('%s is a known action', (action) => {
  expect(knownAction(action)).toBe(action);
});

test.each([
  ['a code of a later release', 'signature.exploded'],
  ['a known code in capitals', 'SIGNATURE.REVOKED'],
  ['a known code with a space after it', 'signature.revoked '],
  ['a label', 'Signature revoked'],
  ['nothing', ''],
  ['markup', '<img src=x onerror=alert(1)>'],
])('%s is not a known action', (_what, code) => {
  expect(knownAction(code)).toBeUndefined();
});
