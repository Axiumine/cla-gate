// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { tenantState } from '../domain/tenant-state.ts';
import {
  findSignDocument,
  findSignRepository,
  type SignDocument,
  type SignRepository,
} from './sign-context-queries.ts';

// What a sign link points at, found the same way for the sign page (E13-S02) and the sign request (E13-S04): the repository by
// GitHub's id, the tenant that holds it, and the document in force with its active version. One function, so the page and the
// request cannot disagree about which repositories can be signed for, or about what a visitor learns about the ones that cannot.

/** Who asks: the person of the session. `sessionRowId` is `sessions.id`, whose captured addresses are offered. */
export interface SignViewer {
  /** `users.id`. */
  readonly userId: number;
  /** The identity: the numeric GitHub id. */
  readonly githubId: GithubId;
  /** The display snapshot of the login. */
  readonly login: string;
  readonly sessionRowId: number;
}

/**
 * `not_found` is the answer for an unknown repository and for one whose installation is not served (rejected by the admission
 * policy, uninstalled or suspended), the same for all so that a visitor learns nothing about which tenants exist;
 * `no_active_cla` is a repository with no document, or a document with no active version.
 */
export type SignTarget =
  | {
      readonly kind: 'found';
      readonly repository: SignRepository;
      /** The tenant that holds the repository: the scope of every later read and write. */
      readonly scope: TenantScope;
      readonly document: SignDocument;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_active_cla' };

const NOT_FOUND: SignTarget = { kind: 'not_found' };

const NO_ACTIVE_CLA: SignTarget = { kind: 'no_active_cla' };

/**
 * The repository that is active under this GitHub id, the tenant behind it and the document it enforces with that document's
 * active version, or why there is none. Whether enforcement is switched on does not matter: a stale link to a repository that
 * was disabled later shows (and signs) the document that is attached. Every read after the first carries the installation id.
 */
export async function resolveSignTarget(db: Kysely<Database>, githubRepoId: number): Promise<SignTarget> {
  const repository = await findSignRepository(db, githubRepoId);
  if (repository === null || tenantState(repository) !== 'active') {
    return NOT_FOUND;
  }
  if (repository.claDocumentId === null) {
    return NO_ACTIVE_CLA;
  }
  const scope = { installationId: repository.installationId };
  const document = await findSignDocument(db, scope, repository.claDocumentId);
  return document === null ? NO_ACTIVE_CLA : { kind: 'found', repository, scope, document };
}
