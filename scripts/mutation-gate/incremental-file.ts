// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type Env, variable } from '../ci/lib/env.ts';
import type { Io } from '../ci/lib/io.ts';
import { incrementalFileOf, SHARD_NAMES } from './shards.ts';

// `yarn mutate:check-incremental` (E20-S04): drops an incremental file that Stryker could not read, so that it is never
// cached. Stryker reads `reports/stryker-incremental-<shard>.json` at start-up and rethrows every error but "no such file"
// (its project reader), so a truncated or otherwise broken file stops every later run before the first mutant. The CI job
// saves the file after the run, also after a stop, and a run that was stopped for the second time (Stryker exits at once
// on a second signal) can leave half a file; saved under the newest key it would be the file every later run restores,
// until the config hash changed. The job runs this check after the restore and before the save: a file that cannot be
// read is deleted, with a warning, and the shard starts cold (after the restore) or keeps the previous cache (before the
// save, because nothing new is saved). The shard comes from STRYKER_SHARD, as in the run step, and a name that is not a
// shard is an error: a typo must not check the wrong file and pass.

const position = z.object({ line: z.number(), column: z.number() });
const range = z.object({ start: position, end: position });
/**
 * What Stryker's project reader dereferences, no more: `files` with the `mutants` and their `location`s, and the optional
 * `testFiles` with their `tests` and the optional locations. A report that has these is read; one that lacks them makes the
 * reader throw. Other fields are not checked here (extra keys stay).
 */
const readable = z.object({
  files: z.record(z.string(), z.object({ mutants: z.array(z.object({ location: range })) })),
  testFiles: z
    .record(z.string(), z.object({ tests: z.array(z.object({ location: z.object({ start: position }).optional() })) }))
    .optional(),
});

/** Whether Stryker's project reader can read this text as an incremental report. */
export function isReadable(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return readable.safeParse(raw).success;
  } catch {
    return false;
  }
}

/** The text of the file, or undefined when it does not exist. Another failure (a directory, no permission) is thrown. */
function readIfPresent(file: string): string | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer and CI tool: <root>/reports/stryker-incremental-<shard>.json, the shard checked against the shard list
    return fs.readFileSync(file, 'utf8');
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}

/** Exit code: 0 whether the file was absent, kept or deleted; 2 when STRYKER_SHARD is not a shard. */
export function runCheckIncremental(env: Env, io: Io, root: string): number {
  const shard = variable(env, 'STRYKER_SHARD');
  if (!SHARD_NAMES.includes(shard)) {
    io.err(`STRYKER_SHARD must be one of ${SHARD_NAMES.join(', ')}, not ${JSON.stringify(shard)}`);
    return 2;
  }
  const relative = incrementalFileOf(shard);
  const file = path.join(root, relative);
  const text = readIfPresent(file);
  if (text === undefined) {
    io.out(`${relative}: no file, nothing to check`);
  } else if (isReadable(text)) {
    io.out(`${relative}: readable, kept`);
  } else {
    fs.rmSync(file, { force: true });
    io.out(
      `::warning title=Stryker incremental file::${relative} is not a Stryker report Stryker can read (cut short by a stop?); deleted, so that it is not cached and the next run does not stop at start-up`,
    );
  }
  return 0;
}
