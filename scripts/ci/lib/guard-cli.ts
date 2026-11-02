// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { compareNames, printable } from '../../code-caps/types.ts';
import { messageOf } from './errors.ts';
import type { Io } from './io.ts';
import { checkWorkflow, formatViolation, type Violation, WorkflowError } from './workflow-guard.ts';

const WORKFLOWS_DIR = '.github/workflows';
const EXTENSIONS: ReadonlySet<string> = new Set(['.yml', '.yaml']);

/** Repository-relative paths (always with `/`) of every .yml and .yaml file directly inside .github/workflows. */
export function workflowFiles(root: string): string[] {
  const directory = path.join(root, WORKFLOWS_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the directory is --root or the repository root
  const names = fs.readdirSync(directory);
  return (
    names
      .filter((name) => EXTENSIONS.has(path.extname(name).toLowerCase()))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: a name just listed from the workflows directory
      .filter((name) => fs.statSync(path.join(directory, name)).isFile())
      .map((name) => `${WORKFLOWS_DIR}/${name}`)
      .sort(compareNames)
  );
}

function parseWorkflow(root: string, file: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: a file listed by workflowFiles
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  try {
    // The parser rejects duplicate keys, several documents and alias bombs, which is what we want from untrusted input.
    return parse(text);
  } catch (error) {
    throw new WorkflowError(`${printable(file)}: not valid YAML: ${messageOf(error).split('\n', 1).join('')}`);
  }
}

/** Every violation in every workflow file under `root`; throws on a file the guard cannot judge. */
export function checkRepository(root: string): { files: number; violations: Violation[] } {
  const files = workflowFiles(root);
  const violations = files.flatMap((file) => checkWorkflow(file, parseWorkflow(root, file)));
  return { files: files.length, violations };
}

function parseRoot(argv: readonly string[], defaultRoot: string): string {
  const { values } = parseArgs({ args: [...argv], options: { root: { type: 'string' } }, strict: true });
  return values.root ?? defaultRoot;
}

/** Exit code: 0 ok, 1 violations, 2 unusable input (unreadable directory, malformed YAML, not a workflow, bad option). */
export function main(argv: readonly string[], defaultRoot: string, io: Io): number {
  try {
    const { files, violations } = checkRepository(parseRoot(argv, defaultRoot));
    for (const violation of violations) {
      io.err(formatViolation(violation));
    }
    if (violations.length > 0) {
      io.err(`ci runners FAILED: ${violations.length} violation(s) in ${files} workflow file(s)`);
      return 1;
    }
    io.out(`ci runners ok (${files} workflow file(s))`);
    return 0;
  } catch (error) {
    io.err(`ci runners: ${messageOf(error)}`);
    return 2;
  }
}
