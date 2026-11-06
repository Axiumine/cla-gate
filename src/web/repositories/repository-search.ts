// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { digitsAsText } from '../ui/search-text.ts';
import { queryOf } from './repository-filters.ts';

// What the address of the Repositories screen holds (E18-S10): `/installations/$installationId/repositories?q=&enabled=&cursor=`, the
// search and the page the person is looking at, so a reload, a pasted link and the browser's Back land on the same view. Every value is
// checked and a value that is not one is dropped: the screen then shows what it would without it.

/** The longest `cursor` the endpoint reads (1 to 1024 characters, the bound of every paged list). */
const MAX_CURSOR_LENGTH = 1024;

/** The router reads `true` and `false` as booleans; the two words as text are the same filter (a hand-written address). */
function wordsAsBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  return value === 'false' ? false : value;
}

/**
 * `?q=` is the search text, in the form `queryOf` gives (trimmed, at most as long as a full name can be); `?enabled=` is `true` for the
 * repositories that enforce the CLA and `false` for those that do not (both is no parameter); `?cursor=` is a text of the length the
 * endpoint takes and is kept and handed back, never read. The search is only ever sent in a request that the server filters by tenant.
 */
export const repositorySearchSchema = z.object({
  q: z.preprocess(digitsAsText, z.string().transform(queryOf)).optional().catch(undefined),
  enabled: z.preprocess(wordsAsBoolean, z.boolean()).optional().catch(undefined),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
});
