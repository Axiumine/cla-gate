// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { afterEach } from 'vitest';
import { measureSource } from './measure.ts';
import { nestingDepth } from './nesting.ts';
import type { Io } from './report.ts';

const FILLER = '  const x = 1;\n';
const MEMBER_FILLER = '  a = 1;\n';
const created: string[] = [];

/**
 * What git exports to a hook so that the commands it runs find the repository being committed: a temporary index (with
 * `git commit <paths>` or `-a`), the git directory, the work tree and the author and committer identity. A scratch
 * repository made by a test must not inherit them, or `git add` there writes into the real repository's index.
 */
export const GIT_HOOK_VARIABLES = [
  'GIT_INDEX_FILE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_QUARANTINE_PATH',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
] as const;

/** Removes `GIT_HOOK_VARIABLES` from `env` in place. */
export function scrubGitHookEnv(env: Record<string, string | undefined>): void {
  for (const name of GIT_HOOK_VARIABLES) {
    Reflect.deleteProperty(env, name);
  }
}

// Every test file that builds a scratch repository imports this module, so the scrub happens once per worker, before
// any of them runs git.
scrubGitHookEnv(process.env);

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Fresh temp directory (outside any git repo), removed after the current test. */
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-caps-'));
  created.push(dir);
  return dir;
}

export function makeRepo(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: target inside a temp directory created by the test
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: target inside a temp directory created by the test
    fs.writeFileSync(target, text, 'utf8');
  }
}

/** Run git in `root` without reading the user's git configuration. */
export function git(root: string, ...args: string[]): void {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull };
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is looked up on PATH on purpose; the argv is fixed
  execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
}

/** `head`, filler lines, `tail`: exactly `lines` lines in all. */
export function block(head: string, tail: string, lines: number): string {
  return `${head}\n${FILLER.repeat(lines - 2)}${tail}\n`;
}

/** Like `block`, filled with class members instead of statements. */
export function classBlock(head: string, tail: string, lines: number): string {
  return `${head}\n${MEMBER_FILLER.repeat(lines - 2)}${tail}\n`;
}

/** A top-level function of exactly `lines` lines. */
export function func(name: string, lines: number, params = ''): string {
  return block(`function ${name}(${params}) {`, '}', lines);
}

/** `{"kind:name": value}` of the violations found in `source`. */
export function kinds(source: string, rel = 'm.ts'): Record<string, number> {
  const pairs = measureSource(source, rel).map((item): [string, number] => [`${item.kind}:${item.name}`, item.value]);
  return Object.fromEntries(pairs);
}

/** Nesting depth of top-level `statements` (parsed as the file kind of `rel`). */
export function depthOf(statements: string, rel = 'm.ts'): number {
  return nestingDepth(ts.createSourceFile(rel, statements, ts.ScriptTarget.Latest, true).statements);
}

export function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (line) => {
      out.push(line);
    },
    err: (line) => {
      err.push(line);
    },
  };
  return { io, out, err };
}
