// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type CorporateFacts, indexCorporateCover, type Policy } from '../../domain/evaluation/index.ts';
import { listCorporateCoverRows } from '../corporate-coverage-queries.ts';
import type { PolicyScope } from './policy-facts.ts';

// The corporate coverage an evaluation reads (E21-S05): one statement for the people of the pull request, as plain ids. It is read as late as the
// signatures are, after everything that takes time, because an approval is something a manager or an employee can add while the job runs.

/** No one is covered by a corporate agreement and no one holds an outdated approval: what a repository without a corporate document reads. */
const NO_CORPORATE_FACTS: CorporateFacts = { covered: new Map(), outdated: new Set() };

/**
 * Who the corporate agreements of the tenant cover among `githubIds`, under the corporate document of the repository. Nothing is read, and no
 * statement is made, when the repository has no corporate document or no active CLA to cover (an agreement cannot stand in for a document that
 * does not exist) or when nobody is asked about. The statement filters by the installation of the tenant, and the decision is the pure
 * `indexCorporateCover`.
 */
export async function readCorporateFacts(
  scope: PolicyScope,
  at: {
    readonly policy: Policy | null;
    readonly corporateDocumentId: number | null;
    readonly githubIds: readonly number[];
  },
): Promise<CorporateFacts> {
  const { policy, corporateDocumentId, githubIds } = at;
  if (policy === null || corporateDocumentId === null || githubIds.length === 0) {
    return NO_CORPORATE_FACTS;
  }
  const rows = await listCorporateCoverRows(
    scope.db,
    { installationId: scope.installationId },
    { documentId: corporateDocumentId, githubIds },
  );
  return indexCorporateCover(rows);
}
