// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignatureState } from './signature-state.ts';

// Where a person goes to sign a document again (E13-S06), pure. The list of their own signatures shows the way for the ones that
// no longer cover them. The sign page is keyed on a repository (E13-S02), so the way is a repository that enforces the document.

/** The repositories a signature can send the person to; each is GitHub's numeric id, or `null` when there is none. */
interface ResignRepositories {
  /** The repository the person signed from, while it is still listed for its installation. */
  readonly source: number | null;
  /** The lowest id among the repositories that enforce the document and are still listed. */
  readonly document: number | null;
}

/**
 * The sign page for a signature that is `outdated` or `revoked`: the source repository when it is still there, otherwise the
 * lowest repository that enforces the document, otherwise `null`. An `active` signature has nothing to sign again, so its
 * answer is `null` whatever the repositories are.
 */
export function resignPath(state: SignatureState, repositories: ResignRepositories): string | null {
  if (state === 'active') {
    return null;
  }
  const githubRepoId = repositories.source ?? repositories.document;
  return githubRepoId === null ? null : `/sign/${githubRepoId}`;
}
