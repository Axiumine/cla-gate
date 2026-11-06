// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Messages } from '../i18n/messages.ts';
import type { Translate } from '../i18n/translate.ts';
import type { SelectOption } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import type { RepositoryDocuments } from './repository-documents-query.ts';
import type { AttachedDocument } from './repository-queries.ts';

// The documents a repository can enforce, as the attach dialog offers them (E18-S10): a document is chosen by its id, and "no CLA" is the
// choice that detaches.

/** A document to choose: its id, its name (text a person controls), where it applies and the version in force, if it has been published. */
export interface DocumentChoice {
  readonly id: number;
  readonly name: string;
  readonly scope: 'installation' | 'repository';
  readonly activeVersion: { readonly major: number; readonly minor: number } | null;
}

/**
 * The value of the choice that detaches.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const NONE = 'none';

/** The choices of a repository's documents: its own first, then the installation-wide ones that cover it, in the order the server gave. */
export function choicesOf(documents: RepositoryDocuments): readonly DocumentChoice[] {
  return [
    ...documents.repositoryScoped.map(({ id, name, activeVersion }) => ({
      id,
      name,
      scope: 'repository' as const,
      activeVersion: activeVersion === null ? null : { major: activeVersion.major, minor: activeVersion.minor },
    })),
    ...documents.installationScoped.map(({ id, name, activeVersion }) => ({
      id,
      name,
      scope: 'installation' as const,
      activeVersion,
    })),
  ];
}

/** The document a repository enforces now, as a choice: it is offered even when the list of documents does not hold it. */
export function attachedChoice(document: AttachedDocument): DocumentChoice {
  return { id: document.id, name: document.name, scope: document.scope, activeVersion: document.activeVersion };
}

/** The value of the select for a document, or for no document. */
export function choiceValue(document: { readonly id: number } | null): string {
  return document === null ? NONE : String(document.id);
}

/** The `documentId` of the request that a chosen value stands for: the id, and `null` (detach) for the choice of no CLA. */
export function documentIdOf(value: string): number | null {
  return value === NONE ? null : Number(value);
}

/** The words for the version of a choice: `major.minor`, or that it is not published. */
function versionOf(choice: DocumentChoice, t: Translate<Messages>): string {
  return choice.activeVersion === null
    ? t('repositories.attach.unpublished')
    : `${String(choice.activeVersion.major)}.${String(choice.activeVersion.minor)}`;
}

/**
 * The options of the select: no CLA, then the documents, each with its version and where it applies. `current` is the document the
 * repository enforces; it is an option even when `choices` does not list it, so opening the dialog never selects something else. An
 * `option` can only hold plain text, so the characters that change how text is drawn in a name are written out (`visibleText`).
 */
export function optionsOf(
  choices: readonly DocumentChoice[],
  current: DocumentChoice | null,
  t: Translate<Messages>,
): readonly SelectOption[] {
  const listed =
    current === null || choices.some((choice) => choice.id === current.id) ? choices : [current, ...choices];
  return [
    { value: NONE, label: t('repositories.attach.none') },
    ...listed.map((choice) => ({
      value: choiceValue(choice),
      label: t(`repositories.attach.option.${choice.scope}`, {
        name: visibleText(choice.name),
        version: versionOf(choice, t),
      }),
    })),
  ];
}
