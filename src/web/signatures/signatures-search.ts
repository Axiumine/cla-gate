// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { digitsAsText } from '../ui/search-text.ts';
import { queryOf, STATE_FILTERS } from './signature-filters.ts';

// What the address of the signatures screen holds (E18-S07): `/installations/$installationId/signatures?q=&state=&document=&cursor=`,
// the search and the page the person is looking at, so a reload, a pasted link and the browser's Back land on the same view. Every
// value is checked and a value that is not one is dropped: the screen then shows what it would without it.

/** The longest `cursor` the endpoint reads (1 to 1024 characters, the bound of every paged list). */
const MAX_CURSOR_LENGTH = 1024;

/**
 * `?q=` is the search text, in the form `queryOf` gives (trimmed, at most as long as a login can be); `?state=` is one of the three
 * states (`all` is no parameter); `?document=` is `cla_documents.id` as a positive whole number; `?cursor=` is a text of the length
 * the endpoint takes and is kept and handed back, never read. The ids are only ever sent in a request that the server filters by
 * tenant, so an id of another tenant is the uniform `404` and never data.
 */
export const signaturesSearchSchema = z.object({
  q: z.preprocess(digitsAsText, z.string().transform(queryOf)).optional().catch(undefined),
  state: z.enum(STATE_FILTERS).optional().catch(undefined),
  document: z.int().positive().optional().catch(undefined),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
});
