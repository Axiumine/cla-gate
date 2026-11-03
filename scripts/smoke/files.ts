// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// E19-S08: the few file operations of the smoke stack, each on a path inside the stack's own temporary directory, the
// checkout, or the directory of the logs.

/** A new directory under the system's temporary directory, readable by its owner only. */
export function makeTemporaryDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cla-smoke-'));
}

/** Copies `relative` from the checkout `from` to the same place under `to`, creating the directories on the way. */
export function copyInto(from: string, to: string, relative: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a directory below the stack's own temporary directory
  fs.mkdirSync(path.dirname(path.join(to, relative)), { recursive: true });
  fs.copyFileSync(path.join(from, relative), path.join(to, relative));
}

export function readText(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file of the stack's own temporary directory
  return fs.readFileSync(file, 'utf8');
}

/** Writes `text` to `file`, creating the directory first; the file is readable by its owner only. */
export function writeText(file: string, text: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file of the stack's own temporary directory or of the log directory
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file of the stack's own temporary directory or of the log directory
  fs.writeFileSync(file, text, { mode: 0o600 });
}

/** Removes a directory and everything in it; a directory that is already gone is not an error. */
export function removeDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

/** The names of the entries of a directory. */
export function listNames(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the secrets directory of the stack's own temporary directory
  return fs.readdirSync(directory);
}
