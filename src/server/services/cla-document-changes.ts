// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type ClaDocumentKind, isKindSupported, MAX_DOCUMENTS_PER_INSTALLATION } from '../../shared/cla.ts';
import { normaliseDocumentName } from '../../shared/cla-name.ts';
import type { GithubId } from '../../shared/github-id.ts';
import { lockDocumentCreation } from '../adapters/db/document-lock.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { isUniqueViolation } from '../adapters/db/violations.ts';
import { appendAudit } from './audit.ts';
import { findDocument } from './cla-document-queries.ts';
import type { StoredDocument } from './cla-document-types.ts';
import { countDocuments, insertDocument, updateDocumentName } from './cla-document-writes.ts';
import { type DocumentDetail, readDocument } from './cla-documents.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// What changes a CLA document of a tenant (E12-S01): create and rename. No text is created here and none ships with the
// product (E12-S03). Each rule that a request can break is a `ClaRuleError` the HTTP layer turns into the status of
// `CLA_RULE_STATUS`. Reading is in cla-documents.ts; the numbering and publishing of versions come with E12-S04.

/** The constraint that decides whether a document name is free in its scope: `unique nulls not distinct (installation_id, repository_id, name)` of migration 001. */
const NAME_CONSTRAINT = 'cla_documents_installation_id_repository_id_name_key';

/** Turns the unique violation of the name constraint into the rule it stands for; any other error is the caller's own. */
function readNameConflict(error: unknown): unknown {
  return isUniqueViolation(error, NAME_CONSTRAINT) ? new ClaRuleError('document_name_taken') : error;
}

/** What a new document is made of: the name as the person typed it (it is cleaned here), and where it applies. */
export interface NewDocument {
  readonly name: string;
  readonly kind: ClaDocumentKind;
  /** `repositories.id` of the repository the document is scoped to, or null for the whole installation. */
  readonly repositoryId: number | null;
}

/**
 * Creates a document for the tenant and appends the audit row `cla_document.created` (ids and the kind, never the name) in
 * the same transaction. The count of the tenant's documents and the insert run under the creation lock of the tenant, so
 * two simultaneous requests cannot pass the limit; the unique constraint on the name decides two that race for one name.
 * @throws ClaRuleError `kind_not_supported` (a kind the switch of `isKindSupported` has off), `invalid_name`,
 * `document_limit_reached`, `document_name_taken`, and `not_found` when the repository is another tenant's or removed.
 */
export async function createDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  actorGithubId: GithubId,
  input: NewDocument,
): Promise<StoredDocument> {
  if (!isKindSupported(input.kind)) {
    throw new ClaRuleError('kind_not_supported');
  }
  const name = normaliseDocumentName(input.name);
  if (name === null) {
    throw new ClaRuleError('invalid_name');
  }
  try {
    return await db.transaction().execute(async (trx) => {
      await lockDocumentCreation(trx, scope.installationId);
      if ((await countDocuments(trx, scope)) >= MAX_DOCUMENTS_PER_INSTALLATION) {
        throw new ClaRuleError('document_limit_reached');
      }
      const document = await insertDocument(trx, scope, { ...input, name });
      if (document === null) {
        throw new ClaRuleError('not_found');
      }
      await appendAudit(trx, {
        action: 'cla_document.created',
        installationId: scope.installationId,
        actorGithubId,
        subject: { type: 'cla_document', id: document.id },
        metadata: { document_id: document.id, repository_id: document.repositoryId, kind: document.kind },
      });
      return document;
    });
  } catch (error) {
    throw readNameConflict(error);
  }
}

/**
 * Renames the document `documentId` and appends the audit row `cla_document.renamed` (the id only, never a name) in the same
 * transaction. The name is cleaned like the one at creation. A name equal to the current one changes nothing and records
 * nothing: the document is returned as it is.
 * @throws ClaRuleError `invalid_name`, `document_name_taken` (the name is used in the document's scope), and `not_found`.
 */
export async function renameDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  actorGithubId: GithubId,
  change: { readonly documentId: number; readonly name: string },
): Promise<DocumentDetail> {
  const name = normaliseDocumentName(change.name);
  if (name === null) {
    throw new ClaRuleError('invalid_name');
  }
  try {
    await db.transaction().execute(async (trx) => {
      const current = await findDocument(trx, scope, change.documentId);
      if (current === null) {
        throw new ClaRuleError('not_found');
      }
      if (current.name === name) {
        return;
      }
      await updateDocumentName(trx, scope, change.documentId, name);
      await appendAudit(trx, {
        action: 'cla_document.renamed',
        installationId: scope.installationId,
        actorGithubId,
        subject: { type: 'cla_document', id: change.documentId },
        metadata: { document_id: change.documentId },
      });
    });
  } catch (error) {
    throw readNameConflict(error);
  }
  return readDocument(db, scope, change.documentId);
}
