// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignatureSearchPage } from '../../../shared/signature-search.ts';
import type { FoundPage } from '../../services/signature-search.ts';
import { signatureCursor } from './signature-search-cursor.ts';

// The search for signatures as `GET …/signatures` sends it (E15-S02): the stored rows with their instants as ISO 8601, the strings of
// the signer exactly as stored, and the opaque cursor that stands for the row the next page starts at.

/** A page as `signatureSearchPageSchema` has it. */
export function presentSignaturePage(page: FoundPage): SignatureSearchPage {
  return {
    items: page.items.map((item) => ({
      ...item,
      signedAt: item.signedAt.toISOString(),
      revokedAt: item.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: page.next === null ? null : signatureCursor(page.next),
    truncated: page.truncated,
  };
}
