// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import {
  findDraft,
  findDraftedDocumentIds,
  findDraftRevision,
  lockDraft,
} from '../../../services/cla-draft-queries.ts';
import { deleteDraft, insertDraft, updateDraft } from '../../../services/cla-draft-writes.ts';
import type { Database } from '../schema.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for the statements over the drafts of the CLA documents
// (E12-S03), kept in a file of their own so that the registry stays under the size cap. `TENANT_QUERIES` has the reads under
// `services/cla-draft-queries.ts` and the writes under `services/cla-draft-writes.ts`. Every statement is called for a tenant with that tenant's ids and with another
// tenant's, by the generated test of tenant-queries-matrix.test.ts.

/** The text the entries save; it is not the text of the fixture's draft, so a save that changed a row can be told. */
const SAVED = 'Saved by the registry\n';

/** The installation that owns each draft of the documents with these ids, found by reading the table. */
async function ownersOfDrafts(db: Kysely<Database>, documentIds: readonly number[]): Promise<number[]> {
  const rows = await db
    .selectFrom('cla_drafts')
    .select('installation_id')
    .where('document_id', 'in', documentIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** True for the error of a database that refused a row for a foreign key (`23503`). */
const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';

/**
 * The reads of `cla_drafts`. The repo-scoped document of each tenant has a draft at revision 1 in the world of the tests and
 * the installation-wide one has none (`twoTenants`), which is what the entries rely on.
 */
export const DRAFT_READS: Readonly<Record<string, ScopedQuery>> = {
  findDraft: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const draft = await findDraft(db, scope, ids.scoped.documentId);
      return draft === null ? [] : ownersOfDrafts(db, [ids.scoped.documentId]);
    },
  },
  lockDraft: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const draft = await lockDraft(db, scope, ids.scoped.documentId);
      return draft === null ? [] : ownersOfDrafts(db, [ids.scoped.documentId]);
    },
  },
  findDraftRevision: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const revision = await findDraftRevision(db, scope, ids.scoped.documentId);
      return revision === null ? [] : ownersOfDrafts(db, [ids.scoped.documentId]);
    },
  },
  findDraftedDocumentIds: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const drafted = await findDraftedDocumentIds(db, scope, [ids.documentId, ids.scoped.documentId]);
      return drafted.size === 0 ? [] : ownersOfDrafts(db, [...drafted]);
    },
  },
};

/** The writes over `cla_drafts`, in the world of {@link DRAFT_READS}. */
export const DRAFT_WRITES: Readonly<Record<string, ScopedQuery>> = {
  insertDraft: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    // Written under another tenant's installation id the row pairs a document with an installation that does not own it:
    // the composite foreign key refuses it, and that is the refusal of this entry.
    refusal: isForeignKeyViolation,
    run: async (db, scope, ids) => {
      // The document has no draft in the world, so the insert creates one; the owner is read from the table either way.
      await insertDraft(db, scope, ids.documentId, { contentMd: SAVED, updatedBy: ids.publisherId });
      return ownersOfDrafts(db, [ids.documentId]);
    },
  },
  updateDraft: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const saved = await updateDraft(db, scope, ids.scoped.documentId, {
        contentMd: SAVED,
        updatedBy: ids.publisherId,
        expectedRevision: 1,
      });
      return saved === null ? [] : ownersOfDrafts(db, [ids.scoped.documentId]);
    },
  },
  deleteDraft: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      // The owner is read before the delete: the row is gone afterwards.
      const owners = await ownersOfDrafts(db, [ids.scoped.documentId]);
      const revision = await deleteDraft(db, scope, ids.scoped.documentId);
      return revision === null ? [] : owners;
    },
  },
};
