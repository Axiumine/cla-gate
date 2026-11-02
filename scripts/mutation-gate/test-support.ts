// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../semgrep-rules/test-support.ts';
import type { Shard } from './shards.ts';

/** Every file below `directory`, relative to the repository root, with forward slashes. */
export function filesBelow(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a directory of the repository
  const entries = fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory() ? filesBelow(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
}

/** Whether one file is selected by `mutate` patterns: a positive glob matches it and no `!` glob does. */
export function isMutated(file: string, patterns: readonly string[]): boolean {
  const include = patterns.filter((pattern) => !pattern.startsWith('!'));
  const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return (
    include.some((pattern) => path.matchesGlob(file, pattern)) &&
    !exclude.some((pattern) => path.matchesGlob(file, pattern))
  );
}

/** What the `mutate` patterns select among the files below `roots`. */
export function mutated(patterns: readonly string[], roots: readonly string[]): string[] {
  return roots.flatMap(filesBelow).filter((file) => isMutated(file, patterns));
}

/** The names of the shards whose globs select `file` once `exclusions` are applied: exactly one when the file is assigned. */
export function ownersOf(file: string, shards: readonly Shard[], exclusions: readonly string[]): string[] {
  return shards.filter((shard) => isMutated(file, [...shard.mutate, ...exclusions])).map((shard) => shard.name);
}
