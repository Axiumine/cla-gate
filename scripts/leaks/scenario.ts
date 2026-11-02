// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { InteractionsCallback, IScenario } from '@memlab/api';
import { z } from 'zod';
import { compareNames } from '../code-caps/types.ts';

// E20-S07: finding and checking the scenario files. A scenario default-exports memlab's `{ url, action, back }`.

const isFunction = (value: unknown): boolean => typeof value === 'function';

const scenarioModule = z.object({
  default: z.object({
    url: z.custom<() => string>(isFunction),
    action: z.custom<InteractionsCallback>(isFunction),
    back: z.custom<InteractionsCallback>(isFunction),
  }),
});

/** `canary-navigation` for `/x/canary-navigation.ts`. */
export function scenarioName(file: string): string {
  return path.basename(file, path.extname(file));
}

/** The scenario a loaded module default-exports; throws, naming the file, when it lacks `url`, `action` or `back`. */
export function scenarioOf(loaded: unknown, file: string): IScenario {
  const parsed = scenarioModule.safeParse(loaded);
  if (!parsed.success) {
    throw new Error(`${file} must default-export { url, action, back }, each a function`);
  }
  const { url, action, back } = parsed.data.default;
  return { url, action, back };
}

/** The files named on the command line (relative to `cwd`), or every `*.ts` of `directory` in code point order. */
export function scenarioFiles(
  args: readonly string[],
  places: { readonly cwd: string; readonly directory: string },
  listDirectory: (directory: string) => readonly string[],
): string[] {
  if (args.length > 0) {
    return args.map((arg) => path.resolve(places.cwd, arg));
  }
  return listDirectory(places.directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .sort(compareNames)
    .map((name) => path.join(places.directory, name));
}
