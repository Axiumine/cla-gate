// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { cleanName } from './clean-name.ts';

// The name of a CLA document (E12-S01), cleaned in one place so the screen that previews it and the server that stores it
// agree. A name is display text a maintainer chose: it is stored as the person typed it once cleaned, and every output
// escapes it for its own context (E09, E16, E18).

/**
 * The longest name, in Unicode code points.
 * @internal exported for the tests of the limit
 */
export const DOCUMENT_NAME_MAX_CODE_POINTS = 100;

/**
 * The name that is stored for `raw`, or `null` when `raw` cannot be a name: `cleanName` with the limit of a document's name
 * (1 to {@link DOCUMENT_NAME_MAX_CODE_POINTS} code points).
 */
export function normaliseDocumentName(raw: string): string | null {
  return cleanName(raw, DOCUMENT_NAME_MAX_CODE_POINTS);
}
