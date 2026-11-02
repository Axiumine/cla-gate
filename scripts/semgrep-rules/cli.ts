// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseArgs } from 'node:util';
import { messageOf } from '../ci/lib/errors.ts';
import type { Io } from '../ci/lib/io.ts';
import { printable } from '../code-caps/types.ts';
import { type Download, downloadRuleset, type FetchLike } from './download.ts';
import { RULESETS } from './rulesets.ts';
import { writeRules } from './write.ts';

const LICENCE_NOTE =
  'rules/ stays git-ignored: the Semgrep Rules License v1.0 forbids redistribution, so never commit, upload or cache it outside this checkout';

/** An error message on one line: the newlines `messageOf` keeps are escaped too, so a path in it cannot forge a line. */
function oneLine(error: unknown): string {
  return printable(messageOf(error));
}

type Succeeded = Extract<Download, { ok: true }>;
type Failed = Extract<Download, { ok: false }>;

function partition(downloads: readonly Download[]): { succeeded: Succeeded[]; failed: Failed[] } {
  const succeeded: Succeeded[] = [];
  const failed: Failed[] = [];
  for (const download of downloads) {
    if (download.ok) {
      succeeded.push(download);
    } else {
      failed.push(download);
    }
  }
  return { succeeded, failed };
}

/**
 * Downloads the five rule sets into `rulesDir`. All or nothing: when any download fails, no file is written and a
 * working copy from an earlier run stays as it was. Exit code: 0 ok, 1 a download or a write failed, 2 bad argument.
 */
export async function main(argv: readonly string[], rulesDir: string, io: Io, fetchImpl: FetchLike): Promise<number> {
  try {
    parseArgs({ args: [...argv], options: {}, strict: true });
  } catch (error) {
    io.err(`semgrep-rules: ${oneLine(error)}`);
    io.err('usage: node scripts/fetch-semgrep-rules.ts (no arguments)');
    return 2;
  }
  const { succeeded, failed } = partition(await Promise.all(RULESETS.map((name) => downloadRuleset(name, fetchImpl))));
  for (const { name, reason } of failed) {
    io.err(`semgrep-rules: ${printable(name)}: ${printable(reason)}`);
  }
  if (failed.length > 0) {
    io.err(`semgrep-rules FAILED: ${failed.length} of ${RULESETS.length} rule sets not downloaded, nothing written`);
    return 1;
  }
  try {
    writeRules(rulesDir, succeeded);
  } catch (error) {
    io.err(`semgrep-rules: cannot write ${printable(rulesDir)}: ${oneLine(error)}`);
    return 1;
  }
  io.out(`semgrep-rules ok: ${succeeded.length} rule sets in ${printable(rulesDir)}`);
  io.out(`semgrep-rules: ${LICENCE_NOTE}`);
  return 0;
}
