// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { OVERRIDE_FILE, tail } from './compose.ts';
import { copyInto, readText, writeText } from './files.ts';
import type { StackNames } from './names.ts';
import { overrideFor } from './override.ts';
import type { StackDeps, StackOptions } from './stack-types.ts';

// E19-S08: the directory of a smoke stack: the files compose reads, the override and the secrets.

/** What the compose file mounts or the secrets script reads, relative to the checkout; a test keeps the list equal to the compose file's mounts. */
export const COPIED = [
  'docker-compose.yml',
  '.env.example',
  'scripts/init-secrets.sh',
  'scripts/provision-database.sh',
  'scripts/provision-database.sql',
  'docker/Caddyfile',
];

/**
 * Copies the files compose reads and runs the secrets script on them. Returns the dotenv file that the script made.
 * `overrides` adds keys to services of the compose override (E19-S12).
 */
export async function prepare(
  deps: StackDeps,
  names: StackNames,
  directory: string,
  overrides: StackOptions['overrides'] = {},
): Promise<string> {
  COPIED.forEach((relative) => {
    copyInto(deps.root, directory, relative);
  });
  const compose = readText(path.join(directory, 'docker-compose.yml'));
  writeText(
    path.join(directory, OVERRIDE_FILE),
    overrideFor(compose, { names, context: deps.root, services: overrides }),
  );
  const made = await deps.exec('sh', [path.join(directory, 'scripts/init-secrets.sh')]);
  if (made.code !== 0) {
    throw new Error(`scripts/init-secrets.sh failed (exit ${made.code}): ${tail(made)}`);
  }
  return readText(path.join(directory, '.env'));
}
