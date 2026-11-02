// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { parseGithubId } from '../../shared/github-id.ts';
import type { AuditEntry } from './audit-entry.ts';

/** A person acting; the numeric GitHub id, never a `users.id`. */
export const ACTOR = parseGithubId(41_898_282);

const anything = z.custom<AuditEntry>();

/**
 * Hands `value` to code that expects an {@link AuditEntry} without the type system's blessing: the way a caller written
 * in plain JavaScript, or a value that came from outside, could reach the writer. Tests only.
 */
export const unchecked = (value: unknown): AuditEntry => anything.parse(value);

/** A valid entry of a tenant action; override single fields to break it. */
export function tenantEntry(installationId: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return { action: 'repository.enabled', installationId, actorGithubId: ACTOR, ...overrides };
}
