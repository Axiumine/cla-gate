// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';

// Where the Repositories screen sends a person who has to publish a version (E18-S10): the editor of a document, or the list of the documents
// when there is none to name. A link is a convenience and never the access control: the server decides on every request.

/** A screen of the documents: the editor of one document, or the list of all of them. */
export type EditorTarget = { readonly kind: 'document'; readonly documentId: number } | { readonly kind: 'list' };

/**
 * The screen to offer for `document` (the one that is attached or chosen, if any) to a person with `role`. The editor of a document is for
 * the role its scope needs: an admin of the repository for a repository's own document, an org admin for one that covers the
 * installation. The list of documents is for an org admin. Nothing is offered where the screen would answer `403`.
 */
export function editorTargetOf(
  document: { readonly id: number; readonly scope: 'installation' | 'repository' } | undefined,
  role: InstallationRole | undefined,
): EditorTarget | undefined {
  if (document !== undefined) {
    return document.scope === 'repository' || role === 'org_admin'
      ? { kind: 'document', documentId: document.id }
      : undefined;
  }
  return role === 'org_admin' ? { kind: 'list' } : undefined;
}
