// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { InstallationRole } from '../../shared/installations.ts';
import { type EditorTarget, editorTargetOf } from './editor-target.ts';

// E18-S10: where the screen sends a person who has to publish a version: only where the screen would not answer 403.

const OWN = { id: 21, scope: 'repository' } as const;
const SHARED = { id: 11, scope: 'installation' } as const;

const EDITED: readonly (readonly [string, typeof OWN | typeof SHARED, InstallationRole, EditorTarget])[] = [
  ['an org admin and a document of the repository', OWN, 'org_admin', { kind: 'document', documentId: 21 }],
  ['a repo admin and a document of the repository', OWN, 'repo_admin', { kind: 'document', documentId: 21 }],
  ['an org admin and a document of the installation', SHARED, 'org_admin', { kind: 'document', documentId: 11 }],
];

test.each(EDITED)('%s: the editor of the document', (_what, document, role, expected) => {
  expect(editorTargetOf(document, role)).toEqual(expected);
});

const NOTHING: readonly (readonly [string, typeof OWN | typeof SHARED | undefined, InstallationRole | undefined])[] = [
  ['a repo admin and a document of the installation', SHARED, 'repo_admin'],
  ['a document and a role that is not known', SHARED, undefined],
  ['no document and a repo admin', undefined, 'repo_admin'],
  ['no document and a role that is not known', undefined, undefined],
];

test.each(NOTHING)('%s: nothing is offered', (_what, document, role) => {
  expect(editorTargetOf(document, role)).toBeUndefined();
});

test('no document and an org admin: the list of documents', () => {
  expect(editorTargetOf(undefined, 'org_admin')).toEqual({ kind: 'list' });
});

test('a document of the repository and a role that is not known: the editor, which the server then decides about', () => {
  expect(editorTargetOf(OWN, undefined)).toEqual({ kind: 'document', documentId: 21 });
});
