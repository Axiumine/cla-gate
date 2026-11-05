// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AUDIT_ACTIONS } from './audit.ts';
import { AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_PATH, AUDIT_SUBJECT_TYPE_PATTERN, auditLogPageSchema } from './audit-log.ts';
import { defineRoute } from './contract.ts';
import { githubIdSchema } from './github-id.ts';
import { installationParamsSchema } from './installations.ts';

// The route descriptor of the audit log viewer (E16-S02) that the audit screen of E18-S09 calls by: the path and the schema of the
// answer are those of audit-log.ts, so the screen and the server cannot drift apart. The server reads the query string as text
// (src/server/adapters/http/audit-log-query.ts); this is the same query as the screen sends it, with numbers as numbers.

/** The longest `cursor` the server reads: the cursor it makes is about 70 characters, and a longer text is not one of its own. */
const MAX_CURSOR_LENGTH = 1024;

/**
 * What the screen may ask the log for: a page (`limit` of 1 to 200 and the `cursor` of the page before), one action, the numeric id
 * of the actor, the kind and the id of the subject, and a range of time in UTC (`from` included, `to` excluded). Any other key is an
 * error here as it is a `400` at the server, so a misspelt filter is never an unfiltered list.
 */
const auditLogQuerySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorGithubId: githubIdSchema.optional(),
  subjectType: z.string().regex(AUDIT_SUBJECT_TYPE_PATTERN).optional(),
  subjectId: z.int().positive().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.int().min(1).max(AUDIT_LOG_MAX_LIMIT).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

/** `GET .../installations/:installationId/audit-log` (E16-S02): the audit trail of one tenant, newest first, for an org admin. */
export const auditLogRoute = defineRoute({
  method: 'GET',
  path: AUDIT_LOG_PATH,
  params: installationParamsSchema,
  query: auditLogQuerySchema,
  responses: { 200: auditLogPageSchema },
});
