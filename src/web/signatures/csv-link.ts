// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fillPath } from '../../shared/contract.ts';
import { SIGNATURE_EXPORT_DEFAULT_STATE, SIGNATURES_CSV_PATH } from '../../shared/signature-export.ts';
import type { StateFilter } from './signature-filters.ts';

// The address of the CSV export of one document (E18-S07). It carries the document and the status and nothing else: the export has
// no search and no dates in this screen, so what the person typed in the search box never reaches it.

/** The path of the export of one document of one tenant, then `?state=` (the word `all` when no status is chosen). */
export function csvLinkOf(installationId: number, documentId: number, state: StateFilter | undefined): string {
  const path = fillPath(SIGNATURES_CSV_PATH, (name) => String(name === 'installationId' ? installationId : documentId));
  return `${path}?state=${state ?? SIGNATURE_EXPORT_DEFAULT_STATE}`;
}
