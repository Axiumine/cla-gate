// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { LeakDeps } from './deps.ts';

// E20-S07: the real file system and module loader behind the wrapper. Paths come from scripts/leaks/paths.ts, the
// scenario files of the repository, or arguments typed by whoever runs the command.

/** Imports a scenario module (Node strips the types of a `.ts` file). */
export function loadModule(file: string): Promise<unknown> {
  // eslint-disable-next-line no-unsanitized/method -- a file URL of a scenario file in this repository, or one named on the command line by whoever runs it
  return import(pathToFileURL(file).href);
}

export const systemFiles: LeakDeps['files'] = {
  list: (directory) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a repository directory from paths.ts
    return fs.readdirSync(directory);
  },
  makeDirectory: (directory) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- below reports/leaks, from paths.ts and a scenario file name
    fs.mkdirSync(directory, { recursive: true });
  },
  write: (file, text) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- below reports/leaks, from paths.ts and a scenario file name
    fs.writeFileSync(file, text);
  },
};
