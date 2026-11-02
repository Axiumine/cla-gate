// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Env } from './env.ts';
import type { Io } from './io.ts';

export interface Sink {
  /** Hides `value` in the Actions log. */
  readonly secret: (value: string) => void;
  /** Exports `name=value` to the next steps (the GITHUB_ENV file), or prints it outside Actions. */
  readonly set: (name: string, value: string) => void;
}

/**
 * Where a CI helper puts what the next steps need. Under Actions (GITHUB_ENV names a file) secrets are masked in the log
 * and assignments are appended to that file; anywhere else (an empty GITHUB_ENV counts as unset) nothing is masked and
 * the assignments are printed.
 */
export function sinkFor(env: Env, io: Io, appendFile: (file: string, text: string) => void): Sink {
  const file = env['GITHUB_ENV'] ?? '';
  if (file === '') {
    return {
      secret: () => undefined,
      set: (name, value) => {
        io.out(`${name}=${value}`);
      },
    };
  }
  return {
    secret: (value) => {
      io.out(`::add-mask::${value}`);
    },
    set: (name, value) => {
      appendFile(file, `${name}=${value}\n`);
    },
  };
}
