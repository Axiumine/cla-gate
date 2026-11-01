// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { measureSource } from './measure.ts';
import { CapsError, compareNames, type Measure, printable } from './types.ts';

const EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** Never source of this repository, at any depth, whatever git says (tool state, vendored releases). */
const TOOL_DIRS: ReadonlySet<string> = new Set(['.git', '.gitnexus', '.claude', '.idea', '.yarn', 'node_modules']);

/** Build and report output. Skipped only when walking a plain directory: git already knows via .gitignore. */
const OUTPUT_DIRS: ReadonlySet<string> = new Set([
  '.stryker-tmp',
  '.vitest',
  'build',
  'dist',
  'coverage',
  'reports',
  'playwright-report',
  'test-results',
]);

/** Tracked + untracked-but-not-ignored source files, or `undefined` outside a git repo. */
function gitFiles(root: string): string[] | undefined {
  const pathspec = [...EXTENSIONS].map((extension) => `*${extension}`);
  const args = ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspec];
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is looked up on PATH on purpose; the argv is fixed
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: Number.POSITIVE_INFINITY,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter((name) => name !== '');
  } catch {
    return undefined;
  }
}

/** Every file below `dir` (posix paths relative to the root), pruning tool and output directories. */
function walkFiles(root: string, dir = ''): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: walks the repository root given by --root or the cwd
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      const pruned = TOOL_DIRS.has(entry.name) || OUTPUT_DIRS.has(entry.name);
      return pruned ? [] : walkFiles(root, rel);
    }
    return [rel];
  });
}

function isSource(root: string, rel: string): boolean {
  const parts = rel.split('/');
  const inToolDir = parts.slice(0, -1).some((part) => TOOL_DIRS.has(part));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: entry of the repository file list
  const isFile = fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile() === true;
  return !inToolDir && EXTENSIONS.has(path.extname(rel)) && isFile;
}

/** A source file whose name is not valid UTF-8 cannot be opened by its decoded name: fail, never skip it. */
function assertDecodable(files: readonly string[]): void {
  const mangled = files.find((rel) => rel.includes('�') && EXTENSIONS.has(path.extname(rel)));
  if (mangled !== undefined) {
    throw new CapsError(`file name is not valid UTF-8: ${printable(mangled)}`);
  }
}

/**
 * Every repo source file outside the excluded directories, as sorted posix paths.
 * @internal Exported for the unit tests.
 */
export function sourceFiles(root: string): string[] {
  const files = gitFiles(root) ?? walkFiles(root);
  assertDecodable(files);
  return files.filter((rel) => isSource(root, rel)).sort(compareNames);
}

/** Violations across the whole repository. Throws `CapsError` naming the file on a syntax error. */
export function measureRepo(root: string): Measure[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: source file of the repository file list
  return sourceFiles(root).flatMap((rel) => measureSource(fs.readFileSync(path.join(root, rel), 'utf8'), rel));
}
