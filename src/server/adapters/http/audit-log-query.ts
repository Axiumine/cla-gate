// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../../../shared/audit.ts';
import { AUDIT_LOG_DEFAULT_LIMIT, AUDIT_LOG_MAX_LIMIT, AUDIT_SUBJECT_TYPE_PATTERN } from '../../../shared/audit-log.ts';
import { auditCursorSchema } from '../../domain/audit-cursor.ts';
import { idText, instantText } from './query-values.ts';

// What a request for the audit log may carry (E16-S02). The query string is untrusted input: every value is checked here,
// and a value that fails is a `400`. The ids are the numeric ones (a GitHub id, or the id of the subject row), never a login.

/** The `limit` of a page: 1 to {@link AUDIT_LOG_MAX_LIMIT} in plain digits, {@link AUDIT_LOG_DEFAULT_LIMIT} when absent. */
const limitText = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().min(1).max(AUDIT_LOG_MAX_LIMIT))
  .default(AUDIT_LOG_DEFAULT_LIMIT);

/** The kind of the row an audit entry is about: the shape the writer accepts for `subject.type`. */
const subjectType = z.string().regex(AUDIT_SUBJECT_TYPE_PATTERN);

/**
 * The query string of `GET …/audit-log`. `action` is a member of `AUDIT_ACTIONS`; `from` is inclusive and `to` exclusive;
 * `cursor` is what an earlier page returned as `nextCursor`. A parameter it does not know is an error too, so a misspelt
 * filter shows up as a `400` and not as an unfiltered list.
 */
export const auditLogQuerySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorGithubId: idText.optional(),
  subjectType: subjectType.optional(),
  subjectId: idText.optional(),
  from: instantText.optional(),
  to: instantText.optional(),
  limit: limitText,
  cursor: auditCursorSchema.optional(),
});
