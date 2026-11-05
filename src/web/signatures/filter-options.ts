// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Messages } from '../i18n/messages.ts';
import type { Translate } from '../i18n/translate.ts';
import type { SelectOption } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { STATE_FILTERS, type StateFilter } from './signature-filters.ts';
import type { DocumentChoice } from './use-document-choices.ts';

/** The value of the choice that is no filter, in both selects. */
export const ALL = '';

/** The status a chosen value stands for: one of the three states, and nothing (all) for any other. */
export function stateOf(value: string): StateFilter | undefined {
  return STATE_FILTERS.find((state) => state === value);
}

/** The document a chosen value stands for: its id, and nothing (all documents) for the choice of all. */
export function documentOf(value: string): number | undefined {
  return value === ALL ? undefined : Number(value);
}

/** The choices of the status filter: all, then the three states by the words of their badges. */
export function stateOptions(t: Translate<Messages>): readonly SelectOption[] {
  return [
    { value: ALL, label: t('signatures.filter.state.all') },
    ...STATE_FILTERS.map((state) => ({ value: state, label: t(`status.${state}`) })),
  ];
}

/**
 * The name of a document in the filter: a repository's document says which repository it is of, because two can have the same name. An
 * `option` can only hold plain text, so the characters that change how text is drawn (a right-to-left override) are written out.
 */
function labelOf(document: DocumentChoice, t: Translate<Messages>): string {
  const name = visibleText(document.name);
  return document.repository === null
    ? name
    : t('signatures.filter.document.repository', { name, repository: visibleText(document.repository) });
}

/**
 * The choices of the document filter: all documents, then the documents the viewer may read. A document that is only in the address
 * (`selected`) and not among them is still a choice, named by its id, and the server decides about it.
 */
export function documentOptions(
  documents: readonly DocumentChoice[],
  selected: number | undefined,
  t: Translate<Messages>,
): readonly SelectOption[] {
  const unlisted = selected !== undefined && !documents.some((document) => document.id === selected);
  return [
    { value: ALL, label: t('signatures.filter.document.all') },
    ...(unlisted ? [{ value: String(selected), label: t('signatures.filter.document.byId', { id: selected }) }] : []),
    ...documents.map((document) => ({ value: String(document.id), label: labelOf(document, t) })),
  ];
}
