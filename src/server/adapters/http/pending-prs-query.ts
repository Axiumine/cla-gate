// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { pageQuerySchema } from '../../../shared/cla.ts';
import { PENDING_REASON_CODES } from '../../../shared/pending-prs.ts';
import { idText } from './query-values.ts';

// What a request for the pending pull requests may carry (E15-S07). The query string is untrusted input: every value is checked here,
// and a value that fails is a `400`.

/**
 * The query string of `GET …/pending-prs`: the page of every paged list (`limit` 1 to 100, `cursor` of the page before) with the
 * repository to look at and the reason a pull request has to list. A parameter it does not know is an error too, so a misspelt filter
 * shows up as a `400` and not as an unfiltered list.
 */
export const pendingPrsQuerySchema = pageQuerySchema.extend({
  repositoryId: idText.optional(),
  reason: z.enum(PENDING_REASON_CODES).optional(),
});
