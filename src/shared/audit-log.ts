// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';

// The audit log viewer of a tenant (E16-S02): the path, the page size limits and the shape of a page. The route, its
// tests and the audit screen of the dashboard share them. The query parameters are read by the route
// (src/server/adapters/http/audit-log-query.ts), because the cursor format is the server's own.

/**
 * Where an org admin reads the audit trail of an installation: `:installationId` is `installations.id`, the tenant key of
 * our own tables, never GitHub's installation id (E11-S05).
 */
export const AUDIT_LOG_PATH = '/api/installations/:installationId/audit-log';

/** Rows in a page when the request names no `limit`. */
export const AUDIT_LOG_DEFAULT_LIMIT = 50;

/** The most rows a page may hold; a `limit` above it is a `400`. */
export const AUDIT_LOG_MAX_LIMIT = 200;

/**
 * One audit row as the viewer sees it. `actor` is `null` for an action the system performed (a webhook, a schedule). The
 * `login` is the display snapshot of the `users` row at the time of the request and is never stored in the audit table;
 * an erased person shows the scrubbed `erased-<id>`, and it is `null` only when the instance holds no user row for that
 * id. `metadata` is the object as stored: ids, counts, flags and codes only.
 */
export const auditLogItemSchema = z.object({
  id: z.int().positive(),
  /** ISO 8601 in UTC with milliseconds. */
  occurredAt: z.iso.datetime({ offset: false }),
  /** Not narrowed to `AUDIT_ACTIONS`: a row outlives the release that wrote it, and a page must still be readable. */
  action: z.string().min(1),
  actor: z.object({ githubId: githubIdSchema, login: z.string().nullable() }).nullable(),
  subject: z.object({ type: z.string().min(1), id: z.int().positive() }).nullable(),
  metadata: z.record(z.string(), z.json()),
});

/** A page of audit rows, newest first. `nextCursor` is opaque and is `null` on the last page. */
export const auditLogPageSchema = z.object({
  items: z.array(auditLogItemSchema),
  nextCursor: z.string().nullable(),
});
