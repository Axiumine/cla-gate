// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { withSettings } from './dotenv.ts';
import { listNames, readText, replaceSecret, writeText } from './files.ts';
import type { Stack } from './stack-types.ts';

// E19-S12: what an operator does after the first-run setup (E19-S09, install.md): put the credentials into the secret files and
// the App's ids into the dotenv file. The stack is started again afterwards with `docker compose up -d`, which the scenario
// runs itself.

export interface Change {
  /** Lines of the dotenv file (`GITHUB_APP_ID`), applied the way scripts/smoke/dotenv.ts applies the smoke test's own. */
  readonly settings?: Readonly<Record<string, string>>;
  /** New content for secret files that exist already (the empty placeholders of scripts/init-secrets.sh), by file name. */
  readonly secrets?: Readonly<Record<string, string>>;
}

/**
 * Applies `change` to the files of a stack that is up, and touches nothing else. A secret file that does not exist is an
 * error, because compose mounts the files that were there when the stack started. A setting that the stack fixes in the
 * environment of every compose call would be shadowed, so it is an error too.
 */
export function reconfigure(stack: Pick<Stack, 'directory' | 'environment'>, change: Change): void {
  const secrets = path.join(stack.directory, 'secrets');
  const shadowed = Object.keys(change.settings ?? {}).filter((name) => Object.hasOwn(stack.environment, name));
  if (shadowed.length > 0) {
    throw new Error(`${shadowed.join(', ')} is fixed by the stack and cannot be changed`);
  }
  const existing = listNames(secrets);
  const missing = Object.keys(change.secrets ?? {}).filter((name) => !existing.includes(name));
  if (missing.length > 0) {
    throw new Error(`secrets/${missing.join(', secrets/')} does not exist, so compose does not mount it`);
  }
  for (const [name, value] of Object.entries(change.secrets ?? {})) {
    replaceSecret(path.join(secrets, name), value);
  }
  if (change.settings !== undefined) {
    const dotenv = path.join(stack.directory, '.env');
    writeText(dotenv, withSettings(readText(dotenv), change.settings));
  }
}
