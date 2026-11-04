// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { messageOf } from '../ci/lib/errors.ts';
import { composer, secretIn, tail } from './compose.ts';
import { listNames, removeDirectory, writeText } from './files.ts';
import type { StackNames } from './names.ts';
import { redact } from './redact.ts';
import type { StackDeps } from './stack-types.ts';

// E19-S08: taking a smoke stack down, and keeping its logs first.

/** The secrets of the stack: every file of `secrets/`, for the log redaction. */
function secretValues(directory: string): string[] {
  return listNames(path.join(directory, 'secrets'))
    .filter((name) => !name.startsWith('.'))
    .map((name) => secretIn(directory, name));
}

/** Runs every step even when an earlier one failed, and throws what failed, together. */
async function runAll(steps: readonly (readonly [string, () => unknown])[]): Promise<void> {
  const failures: string[] = [];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(`${what}: ${messageOf(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`the smoke stack was not removed cleanly:\n${failures.join('\n')}`);
  }
}

/** What removes a stack and keeps its logs; it works whether the stack came up or not, and for the services of every profile. */
export function removal(deps: StackDeps, names: StackNames, directory: string) {
  const everything = composer(deps, names, directory)('*');
  const saveLogs = async (): Promise<string> => {
    const status = await everything(['ps', '--all']);
    const logs = await everything(['logs', '--no-color', '--timestamps']);
    const file = path.join(deps.logsDirectory, `${names.project}.log`);
    writeText(file, redact(`${status.stdout}\n${logs.stdout}${logs.stderr}`, secretValues(directory)));
    return file;
  };
  const down = (): Promise<void> =>
    runAll([
      ['logs', saveLogs],
      [
        'docker compose down',
        async () => {
          const result = await everything(['down', '--volumes', '--remove-orphans']);
          if (result.code !== 0) {
            throw new Error(tail(result));
          }
        },
      ],
      ['docker image rm', () => deps.exec('docker', ['image', 'rm', '--force', names.image])],
      [
        'temporary directory',
        () => {
          removeDirectory(directory);
        },
      ],
    ]);
  return { saveLogs, down };
}
