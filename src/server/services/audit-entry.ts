// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Insertable } from 'kysely';
import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditAction, INSTANCE_ACTIONS, SYSTEM_ACTIONS } from '../../shared/audit.ts';
import { type AuditMetadata, auditMetadataSchema } from '../../shared/audit-metadata.ts';
import { type GithubId, githubIdSchema } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';

/**
 * One audit row to write (E04-S09). `installationId` is `installations.id` and `actorGithubId` the numeric GitHub id of
 * the person acting: both are required (a `null` is allowed only where the action sets are said to allow it).
 */
export interface AuditEntry {
  readonly action: AuditAction;
  /** `null` only for the actions in `INSTANCE_ACTIONS`. */
  readonly installationId: number | null;
  /** `null` only for the actions in `SYSTEM_ACTIONS`. */
  readonly actorGithubId: GithubId | null;
  readonly subject?: { readonly type: string; readonly id: number };
  readonly metadata?: AuditMetadata;
}

/**
 * The entry broke the audit contract: an action outside the closed set, a missing tenant or actor, a metadata key or
 * value outside the allowlist. A programming error, so it surfaces as a 500 and rolls the caller's transaction back. The
 * message names fields and rules and never repeats a value, because values can be what must not be logged.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); production code lets it propagate.
 */
export class AuditEntryInvalid extends Error {
  override readonly name = 'AuditEntryInvalid';
}

const entrySchema = z
  .strictObject({
    action: z.enum(AUDIT_ACTIONS),
    installationId: z.int().positive().nullable(),
    actorGithubId: githubIdSchema.nullable(),
    subject: z.strictObject({ type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), id: z.int().positive() }).optional(),
    metadata: auditMetadataSchema.optional(),
  })
  .refine((entry) => entry.installationId !== null || INSTANCE_ACTIONS.has(entry.action), {
    path: ['installationId'],
    message: 'a tenant action needs an installation',
  })
  .refine((entry) => entry.actorGithubId !== null || SYSTEM_ACTIONS.has(entry.action), {
    path: ['actorGithubId'],
    message: 'only a system action may have no actor',
  });

/** A key name is safe to print when it looks like one of ours; anything else (an address, a sentence) is not echoed. */
const printable = (key: string): string => (/^[a-z][a-z0-9_]{0,63}$/.test(key) ? key : '?');

/** Field path and rule of every problem. For `custom` issues the rule is our own fixed sentence, else the zod code. */
function describe(issue: z.core.$ZodIssue): string[] {
  const path = issue.path.map(String);
  const rule = issue.code === 'custom' ? issue.message : issue.code;
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => `${[...path, printable(key)].join('.')} (${rule})`);
  }
  return [`${path.join('.') || 'entry'} (${rule})`];
}

/** Validates `entry` and returns the row to insert. @throws AuditEntryInvalid on any violation. */
export function toAuditRow(entry: AuditEntry): Insertable<Database['audit_log']> {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new AuditEntryInvalid(`invalid audit entry: ${parsed.error.issues.flatMap(describe).join('; ')}`);
  }
  const { action, installationId, actorGithubId, subject, metadata } = parsed.data;
  return {
    installation_id: installationId,
    actor_github_id: actorGithubId,
    action,
    subject_type: subject?.type ?? null,
    subject_id: subject?.id ?? null,
    metadata: JSON.stringify(metadata ?? {}),
  };
}
