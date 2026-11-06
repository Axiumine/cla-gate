// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';

// A column of the reads of the CLA documents that is not a column of `cla_documents` (E18-S05), kept out of the statements of
// cla-document-queries.ts so that they stay readable.

/**
 * The `full_name` of the repository a document is scoped to, or null for a document that covers the installation: a display snapshot
 * for the scope of the list of documents. The statement it stands in aliases `cla_documents` as `d`. The repository is looked up by
 * the installation of the document next to its id, so it is the document's own and never one of another tenant.
 */
export const REPOSITORY_NAME = sql<
  string | null
>`(select r.full_name from repositories as r where r.id = d.repository_id and r.installation_id = d.installation_id)`.as(
  'repository_full_name',
);
