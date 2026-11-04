// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { type Exec, realExec } from './exec.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';

export interface TrivyInstallDeps {
  /** Runs `curl`, `tar` and the installed `trivy`; never through a shell. */
  readonly exec: Exec;
  readonly readFile: (file: string) => Uint8Array;
  readonly makeDirectory: (directory: string) => void;
  /** Removes a file; a file that is not there is not an error. */
  readonly removeFile: (file: string) => void;
  /** Appends text to a file (here GITHUB_PATH). */
  readonly appendFile: (file: string, text: string) => void;
}

/** The real dependencies: `curl` and `tar` on the PATH, and the file system. */
export const systemDeps: TrivyInstallDeps = {
  exec: realExec,
  readFile: (file) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the archive in the runner temp directory, built by the installer
    return fs.readFileSync(file);
  },
  makeDirectory: (directory) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a directory in the runner temp directory, built by the installer
    fs.mkdirSync(directory, { recursive: true });
  },
  removeFile: (file) => {
    fs.rmSync(file, { force: true });
  },
  appendFile: postgresDeps.appendFile,
};
