// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { claListedDocumentSchema, documentListResponseSchema } from '../../../shared/cla.ts';
import type { ListedDocument } from '../../services/cla-document-types.ts';
import type { DocumentPage } from '../../services/cla-documents.ts';
import { positionCursor, presentDocument } from './document-presenters.ts';

// How the list of the documents of an installation is answered (E12-S01, E18-S05): a document with its draft flag and the name of its
// repository, and the page with the cursor of the next one. The other presenters of the documents are in document-presenters.ts.

/** A document of the list as `claListedDocumentSchema` has it: the draft flag and the name of its repository come with it. */
function presentListed(document: ListedDocument): z.infer<typeof claListedDocumentSchema> {
  return {
    ...presentDocument(document),
    hasDraft: document.hasDraft,
    repositoryFullName: document.repositoryFullName,
  };
}

/** A page of the documents of an installation as `documentListResponseSchema` has it: the documents, and the cursor of the next page or null. */
export function presentPage(page: DocumentPage): z.infer<typeof documentListResponseSchema> {
  return {
    documents: page.documents.map(presentListed),
    nextCursor: page.next === null ? null : positionCursor(page.next),
  };
}
