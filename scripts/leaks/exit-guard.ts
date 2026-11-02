// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Io } from '../ci/lib/io.ts';
import { EXIT_ERROR } from './outcome.ts';

// E20-S07: memlab ends the process itself (`process.exit(1)`) when it hits an error and has not been told to throw. Exit
// code 1 is the code for "a scenario leaked", so an error would read as a leak, and a `process.exit(0)` anywhere would
// read as a pass. The guard turns every exit that happens before the wrapper has finished into code 2.

/** The part of `process` the guard uses. */
export interface ExitTarget {
  exitCode?: number | string | null | undefined;
  on(event: 'exit', listener: (code: number) => void): unknown;
}

/** Installs the guard and returns the function that retires it; call that once the wrapper has its final exit code. */
export function guardExit(target: ExitTarget, io: Io): () => void {
  let finished = false;
  target.on('exit', (code) => {
    if (!finished) {
      io.err(`leaks: the process was ended with code ${code} before every scenario had finished: that is an error`);
      target.exitCode = EXIT_ERROR;
    }
  });
  return () => {
    finished = true;
  };
}
