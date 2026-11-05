// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignatureExportState } from '../../shared/signature-export.ts';
import type { RoleViewer } from './org-admin.ts';
import type { ListedFor } from './repository-list.ts';
import type { SignaturePosition } from './signature-search-filter.ts';
import { type FoundSignature, toFoundSignature } from './signature-search-item.ts';
import { searchRows } from './signature-search-queries.ts';
import { type SearchScopeDeps, searchableDocuments } from './signature-search-scope.ts';

// The search for signatures a maintainer acts on (E15-S02): the role decides which documents it may read (signature-search-scope.ts),
// one statement reads the page (signature-search-queries.ts) and each row becomes an item (signature-search-item.ts). Nothing here
// writes, and nothing appends an audit row: the export of the same rows is the audited one (E16-S03).

/** What a search asks for: the filters, the page size and the row the page starts at. */
export interface SignatureSearchRequest {
  /** `cla_documents.id`; `null` searches every document the viewer may. */
  readonly documentId: number | null;
  readonly state: SignatureExportState;
  /** `users.github_id`; `null` for any signer. */
  readonly githubUserId: number | null;
  /** The login the signer gave when signing; `null` for any. */
  readonly login: string | null;
  readonly limit: number;
  readonly from: SignaturePosition | null;
}

/** A page of the search: the signatures, where the next page starts (`null` on the last), and whether a repository admin's search was cut. */
export interface FoundPage {
  readonly items: readonly FoundSignature[];
  readonly next: SignaturePosition | null;
  readonly truncated: boolean;
}

/**
 * One page of the signatures of the tenant `listedFor` that `viewer` may read, newest first. An org admin reads every document of
 * the installation; a repository admin the documents of the repositories GitHub confirms they administer. `null` when the request
 * names a document that is not in the tenant or not in the viewer's set. Every statement filters by the installation id.
 * @throws what the role lookups throw for a repository admin: `GitHubUnavailableError`, `GitHubRateLimitedError`,
 * `RoleLookupThrottledError`, `InstallationNotAdmittedError`.
 */
export async function searchSignatures(
  deps: SearchScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  request: SignatureSearchRequest,
): Promise<FoundPage | null> {
  const scope = await searchableDocuments(deps, listedFor, viewer, request.documentId);
  if (scope === null) {
    return null;
  }
  const { documentIds, truncated } = scope;
  if (documentIds?.length === 0) {
    return { items: [], next: null, truncated };
  }
  const { state, githubUserId, login, limit, from } = request;
  const rows = await searchRows(deps.db, listedFor, { documentIds, state, githubUserId, login }, { limit, from });
  const [following] = rows.slice(limit);
  return {
    items: rows.slice(0, limit).map(toFoundSignature),
    next: following === undefined ? null : { signedAt: following.signedAtMicros, id: following.id },
    truncated,
  };
}
