// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';

type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

export interface Violation {
  readonly file: string;
  /** The job id, or null for a violation of the workflow as a whole. */
  readonly job: string | null;
  readonly rule: Rule;
  readonly message: string;
}

/** The file is not a workflow this guard can judge (exit code 2, not 1). */
export class WorkflowError extends Error {
  override readonly name = 'WorkflowError';
}

export type Mapping = Record<string, unknown>;

/** Array.isArray narrows `unknown` to `any[]`, which type-coverage counts against us; this narrows to `unknown[]`. */
export function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !isList(value);
}

/** A value for a message: JSON, shortened, with control characters escaped. */
export function describe(value: unknown): string {
  const text = value === undefined ? 'nothing' : JSON.stringify(value);
  return printable(text.length > 80 ? `${text.slice(0, 77)}...` : text);
}
