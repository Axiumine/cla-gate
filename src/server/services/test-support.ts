// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { AuditEntry } from './audit-entry.ts';
import type { Clock } from './ports/clock.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from './ports/github-errors.ts';
import type { InstallationGate } from './ports/installation-gate.ts';

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

/** A clock that stands still until a test moves it (E05-S02). */
export class FakeClock implements Clock {
  #milliseconds: number;

  constructor(start: string) {
    this.#milliseconds = Date.parse(start);
  }

  now(): Date {
    return new Date(this.#milliseconds);
  }

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }
}

/** A gate that admits every installation except those a test turns away, and keeps the ids it was asked about (E05-S03). */
export class FakeGate implements InstallationGate {
  readonly #refused = new Map<GithubId, NotAdmittedReason>();
  /** Every id the gate was asked about, in order. */
  readonly asked: GithubId[] = [];

  refuse(githubInstallationId: GithubId, reason: NotAdmittedReason): void {
    this.#refused.set(githubInstallationId, reason);
  }

  admit(githubInstallationId: GithubId): void {
    this.#refused.delete(githubInstallationId);
  }

  assertAdmitted(githubInstallationId: GithubId): Promise<void> {
    this.asked.push(githubInstallationId);
    const reason = this.#refused.get(githubInstallationId);
    return reason === undefined ? Promise.resolve() : Promise.reject(new InstallationNotAdmittedError(reason));
  }
}
