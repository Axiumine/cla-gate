// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { currentIndividualConsent } from '../../shared/consent.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import type { Database } from '../adapters/db/schema.ts';
import { readVerifiedEmails } from '../adapters/db/sessions-read.ts';
import { tenantState } from '../domain/tenant-state.ts';
import { findSignDocument, findSignRepository, listViewerSignatures } from './sign-context-queries.ts';
import { documentView, repositoryView, standing } from './sign-context-view.ts';

// The sign page context (E13-S02): one read that says which CLA version applies to a repository, where the viewer stands on it
// and which verified e-mail addresses they can choose. The tenant is the one that holds the repository, found from the GitHub id
// of the repository; every later read carries its installation id. The service writes nothing, renders no Markdown (the page
// renders the stored text) and never contacts GitHub: the addresses are the ones the session captured at login (E10-S05).

/** Who asks: the person of the session. `sessionRowId` is `sessions.id`, whose captured addresses are offered. */
interface SignViewer {
  /** `users.id`. */
  readonly userId: number;
  /** The identity: the numeric GitHub id. */
  readonly githubId: GithubId;
  /** The display snapshot of the login. */
  readonly login: string;
  readonly sessionRowId: number;
}

/** What the sign page asks for: a repository by GitHub's id, and the pull request the person came from, if any. */
export interface SignContextQuery {
  readonly githubRepoId: number;
  readonly prNumber: number | null;
  readonly viewer: SignViewer;
}

/**
 * `not_found` is the answer for an unknown repository and for one whose installation is not served (rejected by the admission
 * policy, uninstalled or suspended), the same for all so that a visitor learns nothing about which tenants exist;
 * `no_active_cla` is a repository with no document, or a document with no active version.
 */
export type SignContextOutcome =
  | { readonly kind: 'found'; readonly context: SignContextResponse }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_active_cla' };

const NOT_FOUND: SignContextOutcome = { kind: 'not_found' };

const NO_ACTIVE_CLA: SignContextOutcome = { kind: 'no_active_cla' };

/**
 * Everything the sign page needs for `query.githubRepoId`, or why there is nothing to show. The repository is found by its
 * GitHub id among the repositories that are still listed for their installation; a repository whose installation is not
 * admitted, was uninstalled or is suspended is `not_found`, exactly like an unknown one. Whether enforcement is switched on
 * does not matter: a stale link to a repository that was disabled later shows the document that is attached.
 */
export async function loadSignContext(db: Kysely<Database>, query: SignContextQuery): Promise<SignContextOutcome> {
  const repository = await findSignRepository(db, query.githubRepoId);
  if (repository === null || tenantState(repository) !== 'active') {
    return NOT_FOUND;
  }
  if (repository.claDocumentId === null) {
    return NO_ACTIVE_CLA;
  }
  const scope = { installationId: repository.installationId };
  const document = await findSignDocument(db, scope, repository.claDocumentId);
  if (document === null) {
    return NO_ACTIVE_CLA;
  }
  const { viewer } = query;
  const [signatures, emails] = await Promise.all([
    listViewerSignatures(db, scope, viewer.userId, document.id),
    readVerifiedEmails(db, viewer.sessionRowId),
  ]);
  const blocked = emails.length === 0;
  return {
    kind: 'found',
    context: {
      ...repositoryView(repository, query.prNumber),
      ...documentView(document),
      consent: currentIndividualConsent(),
      emails: [...emails],
      viewer: { githubId: viewer.githubId, login: viewer.login },
      ...standing(document, signatures),
      canSign: !blocked,
      blockedReason: blocked ? 'no_verified_email' : null,
    },
  };
}
