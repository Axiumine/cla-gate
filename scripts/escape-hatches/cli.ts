// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { messageOf } from '../ci/lib/errors.ts';
import type { Io } from '../ci/lib/io.ts';
import { sourceFiles } from '../code-caps/files.ts';
import { printable } from '../code-caps/types.ts';
import { scanSource } from './scan.ts';
import type { Finding } from './types.ts';

/**
 * One report line: `file:line: hatch: missing element`. The file name is printable, so it cannot forge a line.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function formatFinding(finding: Finding): string {
  return `${printable(finding.file)}:${finding.line}: ${finding.hatch}: missing ${finding.missing}`;
}

/**
 * Every unjustified escape hatch in every source file the caps tool measures (tracked, or not ignored) under `root`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function scanRepository(root: string): { files: number; findings: Finding[] } {
  const files = sourceFiles(root);
  const findings = files.flatMap((file) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: a file listed by sourceFiles under --root or the repository root
    scanSource(file, fs.readFileSync(path.join(root, file), 'utf8')),
  );
  return { files: files.length, findings };
}

function parseRoot(argv: readonly string[], defaultRoot: string): string {
  const { values } = parseArgs({ args: [...argv], options: { root: { type: 'string' } }, strict: true });
  return values.root ?? defaultRoot;
}

/** Exit code: 0 ok, 1 unjustified escape hatches, 2 unusable input (unreadable directory or file, bad option). */
export function main(argv: readonly string[], defaultRoot: string, io: Io): number {
  try {
    const { files, findings } = scanRepository(parseRoot(argv, defaultRoot));
    for (const finding of findings) {
      io.err(formatFinding(finding));
    }
    if (findings.length > 0) {
      io.err(`escape hatches FAILED: ${findings.length} without a justification in ${files} source file(s)`);
      return 1;
    }
    io.out(`escape hatches ok (${files} source file(s))`);
    return 0;
  } catch (error) {
    io.err(`escape hatches: ${messageOf(error)}`);
    return 2;
  }
}
