// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { messages } from '../i18n/messages.ts';
import { createTranslator } from '../i18n/translate.ts';
import { attachedChoice, choicesOf, choiceValue, documentIdOf, NONE, optionsOf } from './document-choices.ts';
import { claOf, installationDocument, repositoryDocument } from './test-support.ts';

// E18-S10: the documents a repository can enforce, as the attach dialog offers them.

const t = createTranslator(messages, 'en');
/** U+202E RIGHT-TO-LEFT OVERRIDE, built here so that no bidi control sits in the source. */
const RLO = String.fromCodePoint(0x202e);
const INDIVIDUAL = installationDocument(11, 'Individual CLA', { major: 1, minor: 0 });

test("a repository's own documents come first, then those of the installation, each with its scope and the version in force", () => {
  expect(
    choicesOf({
      repositoryScoped: [
        repositoryDocument(21, 'Widgets CLA', { major: 2, minor: 3 }),
        repositoryDocument(22, 'Draft', null),
      ],
      installationScoped: [INDIVIDUAL],
    }),
  ).toEqual([
    { id: 21, name: 'Widgets CLA', scope: 'repository', activeVersion: { major: 2, minor: 3 } },
    { id: 22, name: 'Draft', scope: 'repository', activeVersion: null },
    { id: 11, name: 'Individual CLA', scope: 'installation', activeVersion: { major: 1, minor: 0 } },
  ]);
});

test('a repository with no document has no choice', () => {
  expect(choicesOf({ repositoryScoped: [], installationScoped: [] })).toEqual([]);
});

test('the document a repository enforces is a choice of its own, with what the list says of it', () => {
  expect(attachedChoice(claOf({ id: 12, name: 'Other', scope: 'repository', activeVersion: null }))).toEqual({
    id: 12,
    name: 'Other',
    scope: 'repository',
    activeVersion: null,
  });
});

test.each([
  [{ id: 11 }, '11'],
  [null, NONE],
])('the value of %j in the select is %s, and it reads back as the id the request sends', (document, value) => {
  expect(choiceValue(document)).toBe(value);
  expect(documentIdOf(value)).toBe(document?.id ?? null);
});

test('the options are no CLA first, then each document with its version and where it applies', () => {
  const choices = choicesOf({
    repositoryScoped: [
      repositoryDocument(21, 'Widgets CLA', { major: 2, minor: 3 }),
      repositoryDocument(22, 'Draft', null),
    ],
    installationScoped: [INDIVIDUAL],
  });
  expect(optionsOf(choices, null, t)).toEqual([
    { value: 'none', label: 'No CLA (detach)' },
    { value: '21', label: 'Widgets CLA (2.3), this repository only' },
    { value: '22', label: 'Draft (not published), this repository only' },
    { value: '11', label: 'Individual CLA (1.0), whole installation' },
  ]);
});

test('the document the repository has is an option even when the list of documents does not hold it, first, and only once when it does', () => {
  const current = attachedChoice(claOf({ id: 99, name: 'Corporate CLA' }));
  const listed = choicesOf({ repositoryScoped: [], installationScoped: [INDIVIDUAL] });
  expect(optionsOf(listed, current, t).map((option) => option.value)).toEqual(['none', '99', '11']);
  const same = attachedChoice(claOf());
  expect(optionsOf(listed, same, t).map((option) => option.value)).toEqual(['none', '11']);
});

test('the characters that change how text is drawn in a name are written out, because an option can hold only plain text', () => {
  const choices = choicesOf({
    repositoryScoped: [],
    installationScoped: [installationDocument(11, `CLA${RLO}gnp.exe`, { major: 1, minor: 0 })],
  });
  expect(optionsOf(choices, null, t)[1]?.label).toBe('CLA<U+202E>gnp.exe (1.0), whole installation');
});
