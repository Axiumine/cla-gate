// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkTrivyIgnore } from './ignore-file.ts';

/** The ignore file Trivy reads from the working directory. */
export const IGNORE_FILE = '.trivyignore';

const SHA_LENGTH = 40;
const COMMITTER_TIME = /^committer-time (\d+)$/;

/** The final line number of a `git blame --line-porcelain` header (`<sha> <original line> <final line> [<group size>]`). */
function finalLineOf(text: string): number | undefined {
  const [sha = '', original = '', final = '', ...rest] = text.split(' ');
  const numeric = [original, final, ...rest].every((part) => /^\d+$/.test(part));
  return sha.length === SHA_LENGTH && /^[0-9a-f]+$/.test(sha) && numeric && rest.length <= 1
    ? Number(final)
    : undefined;
}

/**
 * When each line of `file` was committed, from `git blame`: line number (1-based) to moment. A line that is not
 * committed yet reports the current moment (git's own answer). Empty when git cannot say: no repository, no commit, or
 * a file that is not tracked yet, in which case every line counts as written now.
 */
export function committedDates(root: string, file: string): ReadonlyMap<number, Date> {
  let output: string;
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is looked up on PATH on purpose; the argv is fixed
    output = execFileSync('git', ['blame', '--line-porcelain', '--', file], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: Number.POSITIVE_INFINITY,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return new Map();
  }
  const dates = new Map<number, Date>();
  let line = 0;
  for (const text of output.split('\n')) {
    line = finalLineOf(text) ?? line;
    const time = COMMITTER_TIME.exec(text)?.[1];
    if (time !== undefined) {
      dates.set(line, new Date(Number(time) * 1000));
    }
  }
  return dates;
}

/**
 * Violations in the `.trivyignore` of the repository at `root`; none when the file does not exist (it is created only
 * when the first ignore is needed). Entries are judged by the day their own line was committed.
 */
export function checkTrivyIgnoreFile(root: string, today: Date): string[] {
  const file = path.join(root, IGNORE_FILE);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file name inside the repository root given by the caller
  if (!fs.existsSync(file)) {
    return [];
  }
  const dates = committedDates(root, IGNORE_FILE);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file name inside the repository root given by the caller
  return checkTrivyIgnore(fs.readFileSync(file, 'utf8'), (line) => dates.get(line) ?? today, today);
}
