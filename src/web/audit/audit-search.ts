// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { AUDIT_SUBJECT_TYPE_PATTERN } from '../../shared/audit-log.ts';
import { endsBeforeStart, instantText } from './audit-instant.ts';

// What the address of the audit screen holds (E18-S09): `/installations/$installationId/audit?action=&actorGithubId=&subjectType=&subjectId=&from=&to=&cursor=`,
// the filters and the page the person is looking at, so a reload, a pasted link and the browser's Back land on the same view. Every
// value is checked and a value that is not one is dropped: the screen then shows what it would without it.

/** The longest `cursor` the endpoint reads (1 to 1024 characters, the bound of every paged list). */
const MAX_CURSOR_LENGTH = 1024;

const wholeNumber = z.int().positive().optional().catch(undefined);

/**
 * `?action=` is a member of the catalogue of audit actions; `?actorGithubId=` and `?subjectId=` are positive whole numbers (the router
 * reads digits as a number); `?subjectType=` is the shape the writer accepts; `?from=` and `?to=` are a date or a UTC instant, read into
 * the canonical text (`instantText`), and a `to` that ends before the `from` is dropped, as the form would not have accepted it;
 * `?cursor=` is a text of the length the endpoint takes and is kept and handed back, never read. The ids are only ever sent in a
 * request that the server filters by tenant, so another tenant's id is never data.
 */
export const auditSearchSchema = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
    actorGithubId: wholeNumber,
    subjectType: z.string().regex(AUDIT_SUBJECT_TYPE_PATTERN).optional().catch(undefined),
    subjectId: wholeNumber,
    from: instantText.optional().catch(undefined),
    to: instantText.optional().catch(undefined),
    cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
  })
  .transform((search) => (endsBeforeStart(search.from, search.to) ? { ...search, to: undefined } : search));
