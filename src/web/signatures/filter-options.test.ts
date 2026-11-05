// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createTranslator, messages } from '../i18n/index.ts';
import { ALL, documentOf, documentOptions, stateOf, stateOptions } from './filter-options.ts';
import type { DocumentChoice } from './use-document-choices.ts';

// E18-S07: the choices of the two selects, and the filter a chosen value stands for.

const t = createTranslator(messages, 'en');

const INDIVIDUAL: DocumentChoice = { id: 11, name: 'Individual CLA', scope: 'installation', repository: null };
const WIDGETS: DocumentChoice = { id: 12, name: 'Widgets CLA', scope: 'repository', repository: 'acme/widgets' };

test('the choice of all is the empty value in both selects', () => {
  expect(ALL).toBe('');
});

test.each([
  ['active', 'active'],
  ['outdated', 'outdated'],
  ['revoked', 'revoked'],
  ['', undefined],
  ['all', undefined],
  ['expired', undefined],
  ['REVOKED', undefined],
] as const)('the chosen status %j is the filter %s', (value, state) => {
  expect(stateOf(value)).toBe(state);
});

test.each([
  ['11', 11],
  ['1', 1],
  ['', undefined],
] as const)('the chosen document %j is the filter %s', (value, document) => {
  expect(documentOf(value)).toBe(document);
});

test('the statuses are all, then the three states by the words of their badges', () => {
  expect(stateOptions(t)).toEqual([
    { value: '', label: messages['signatures.filter.state.all'] },
    { value: 'active', label: messages['status.active'] },
    { value: 'outdated', label: messages['status.outdated'] },
    { value: 'revoked', label: messages['status.revoked'] },
  ]);
});

test('the documents are all, then each by its name, a repository document with the repository it is of', () => {
  expect(documentOptions([INDIVIDUAL, WIDGETS], undefined, t)).toEqual([
    { value: '', label: messages['signatures.filter.document.all'] },
    { value: '11', label: 'Individual CLA' },
    { value: '12', label: 'Widgets CLA (acme/widgets)' },
  ]);
});

test('a document of the address that the list does not have is a choice named by its id, before the listed ones', () => {
  expect(documentOptions([INDIVIDUAL], 99, t)).toEqual([
    { value: '', label: messages['signatures.filter.document.all'] },
    { value: '99', label: 'Document 99' },
    { value: '11', label: 'Individual CLA' },
  ]);
});

test('a document of the address that the list has is not added twice', () => {
  expect(documentOptions([INDIVIDUAL], 11, t).map((option) => option.value)).toEqual(['', '11']);
});

test('the name of a document and its repository are plain text with the hidden characters written out', () => {
  const rlo = String.fromCodePoint(0x202e);
  const options = documentOptions(
    [{ id: 13, name: `exe.${rlo}live`, scope: 'repository', repository: `acme/${rlo}x` }],
    undefined,
    t,
  );
  expect(options[1]?.label).toBe('exe.<U+202E>live (acme/<U+202E>x)');
});
