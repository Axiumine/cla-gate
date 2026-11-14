// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import { describe, isMapping, type Mapping, type Violation } from './guard-types.ts';

/** What the hosted-only workflows (release, scorecard and CodeQL files) may hold on top of `contents: read`. */
const EXTRA_PERMISSIONS: ReadonlyMap<string, string> = new Map([
  ['security-events', 'write'],
  ['id-token', 'write'],
]);

/** Whether a permission is allowed: `contents: read` everywhere, `actions: read` in a job only, the extras in hosted-only files. */
function isAllowed(key: string, level: unknown, hostedOnly: boolean, topLevel: boolean): boolean {
  if (key === 'contents') {
    return level === 'read';
  }
  if (key === 'actions') {
    // E20-S04: the `mutation` job lists the runs and jobs of its own repository (read only, GET only). Never the workflow level.
    return !topLevel && level === 'read';
  }
  return hostedOnly && EXTRA_PERMISSIONS.get(key) === level;
}

/**
 * Problems with a `permissions` value. The workflow level must be a mapping holding contents: read; a job level
 * mapping only has to stay inside the allowed set (an override could otherwise escalate what the top level restricts).
 */
function permissionProblems(value: unknown, hostedOnly: boolean, topLevel: boolean): string[] {
  if (!isMapping(value)) {
    return [`permissions must be a mapping, found ${describe(value)}`];
  }
  const problems: string[] = [];
  if (topLevel && value['contents'] !== 'read') {
    problems.push(`permissions need contents: read, found ${describe(value['contents'])}`);
  }
  for (const [key, level] of Object.entries(value)) {
    if (!isAllowed(key, level, hostedOnly, topLevel)) {
      problems.push(`permission ${printable(key)}: ${describe(level)} is not allowed`);
    }
  }
  return problems;
}

export function checkPermissions(file: string, job: string | null, holder: Mapping, hostedOnly: boolean): Violation[] {
  const where = job === null ? 'top-level ' : '';
  if (holder['permissions'] === undefined) {
    return job === null
      ? [{ file, job, rule: 'R5', message: 'top-level permissions are missing: add "permissions: contents: read"' }]
      : [];
  }
  return permissionProblems(holder['permissions'], hostedOnly, job === null).map((problem) => ({
    file,
    job,
    rule: 'R5',
    message: `${where}${problem}`,
  }));
}
