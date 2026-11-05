// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { tenantState } from '../domain/tenant-state.ts';
import { findCorporateSetting } from './corporate-repository-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import {
  findSignDocument,
  findSignRepository,
  type SignDocument,
  type SignRepository,
} from './sign-context-queries.ts';

// What a corporate sign link points at (E21-S02), found the same way for the page that shows the corporate CLA and for the request
// that signs it: the repository by GitHub's id, the tenant that holds it, and the corporate document it has with its active version.
// One function, so the page and the request cannot disagree about which repositories can be signed for, or about what a visitor
// learns about the ones that cannot.

/** The repository, the tenant that holds it and the corporate document in force with its active version. */
export interface CorporateTarget {
  readonly repository: SignRepository;
  /** The scope of every later read and write. */
  readonly scope: TenantScope;
  readonly document: SignDocument;
}

/** Whether the caller reads (a suspended tenant is served) or writes (a suspended tenant is refused with its own code). */
export type CorporateAccess = 'read' | 'write';

/**
 * The repository that is active under this GitHub id, the tenant behind it and the corporate document it has with that document's
 * active version, or why there is none. Enforcement must be on: a repository that is not enabled has no corporate CLA in force. Every
 * read after the first carries the installation id.
 * @throws CorporateRuleError `not_found` for an unknown repository and for one whose installation is not served (rejected by the
 * admission policy, or uninstalled), the same for all so that a visitor learns nothing about which tenants exist;
 * `installation_suspended` for a write while the installation is suspended (a read is served); `corporate_cla_not_configured` for a
 * repository that is not enabled, has no corporate document, or whose document has no published version.
 */
export async function resolveCorporateTarget(
  db: Kysely<Database>,
  githubRepoId: number,
  access: CorporateAccess,
): Promise<CorporateTarget> {
  const repository = await findSignRepository(db, githubRepoId);
  if (repository === null) {
    throw new CorporateRuleError('not_found');
  }
  const state = tenantState(repository);
  if (state === 'rejected' || state === 'deleted') {
    throw new CorporateRuleError('not_found');
  }
  if (state === 'suspended' && access === 'write') {
    throw new CorporateRuleError('installation_suspended');
  }
  const scope = { installationId: repository.installationId };
  const setting = await findCorporateSetting(db, scope, repository.repositoryId);
  const documentId = setting?.enabled === true ? setting.corporateDocumentId : null;
  // The kind of the document is `corporate` by the trigger of migration 020, which refuses any other for this column.
  const document = documentId === null ? null : await findSignDocument(db, scope, documentId);
  if (document === null) {
    throw new CorporateRuleError('corporate_cla_not_configured');
  }
  return { repository, scope, document };
}
