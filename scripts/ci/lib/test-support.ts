// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Exec, ExecResult } from './exec.ts';
import type { Io } from './io.ts';

export interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>> | undefined;
}

export function ok(stdout = ''): ExecResult {
  return { code: 0, stdout, stderr: '' };
}

export function fail(stderr: string, code = 1): ExecResult {
  return { code, stdout: '', stderr };
}

/**
 * A scripted `docker`: replies are queued per first argument (`run`, `rm`, `inspect`, `logs`, `compose`), the last reply
 * of a queue repeats, and a verb nobody scripted succeeds with no output. Every call is recorded.
 */
export function fakeDocker(entries: readonly (readonly [string, readonly ExecResult[]])[] = []): {
  exec: Exec;
  calls: Call[];
} {
  const queues = new Map(entries);
  const used = new Map<string, number>();
  const calls: Call[] = [];
  const exec: Exec = (file, args, env) => {
    calls.push({ file, args, env });
    const verb = args[0] ?? '';
    const queue = queues.get(verb) ?? [];
    const index = Math.min(used.get(verb) ?? 0, queue.length - 1);
    used.set(verb, (used.get(verb) ?? 0) + 1);
    return Promise.resolve(queue.at(index) ?? ok());
  };
  return { exec, calls };
}

/** An `Io` that records what was printed. */
export function collectIo(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

/** A GitHub Actions expression, `${{ body }}`, built so that no string literal in a test looks like a template. */
export function expression(body: string): string {
  return `\${{ ${body} }}`;
}

// File helpers for tests that work at computed paths; every path is inside a temp directory or the repository.

export function readText(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory or the repository
  return fs.readFileSync(file, 'utf8');
}

export function exists(file: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory or the repository
  return fs.existsSync(file);
}

/** Absolute path of a tool on the PATH of this process: tests that run a script with a doctored PATH still need bash. */
export function findOnPath(tool: string): string {
  const found = String(process.env['PATH'])
    .split(path.delimiter)
    .map((directory) => path.join(directory, tool))
    .find(exists);
  if (found === undefined) {
    throw new Error(`${tool} is needed by this test`);
  }
  return found;
}

/** A file that can be run, like the stub tools of the preflight test. */
export function writeExecutable(file: string, text: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  fs.writeFileSync(file, text, { mode: 0o755 });
}

export function symlink(target: string, file: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  fs.symlinkSync(target, file);
}
