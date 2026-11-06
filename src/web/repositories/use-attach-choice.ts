// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { attachedChoice, choicesOf, choiceValue, type DocumentChoice } from './document-choices.ts';
import type { RepositoryDocuments } from './repository-documents-query.ts';
import type { Repository } from './repository-queries.ts';

/**
 * The choice on screen in the attach dialog (E18-S10): its value, which starts at the document the repository enforces, the choices the
 * select offers once the documents have come, and the one that is chosen, if it is a document: the document the repository enforces
 * counts, though the endpoint does not list it any more.
 */
export function useAttachChoice(repository: Repository, documents: RepositoryDocuments | undefined) {
  const [choice, setChoice] = useState(choiceValue(repository.document));
  const current = repository.document === null ? null : attachedChoice(repository.document);
  const choices: readonly DocumentChoice[] = documents === undefined ? [] : choicesOf(documents);
  const chosen = [...(current === null ? [] : [current]), ...choices].find(
    (candidate) => choiceValue(candidate) === choice,
  );
  return { choice, setChoice, current, choices, chosen };
}
