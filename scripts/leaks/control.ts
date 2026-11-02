// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { Io } from '../ci/lib/io.ts';
import { EXIT_CLEAN, EXIT_ERROR, EXIT_LEAKS } from './outcome.ts';

// E20-S07: the guard against a memlab that silently reports nothing. The real wrapper runs three scenarios in child
// processes, and the exit code each one gives is compared with the one it must give: a fixture that leaks on purpose must
// fail the wrapper, a clean fixture must pass it, and a scenario that cannot run must end in the error code.

export interface ControlCase {
  readonly name: string;
  readonly expected: number;
  /** What it means for the wrapper when the exit code is anything else. */
  readonly ifWrong: string;
}

export interface ControlDeps {
  readonly io: Io;
  /** The directory that holds `<case name>.ts` for every case. */
  readonly directory: string;
  /** Runs the wrapper on one scenario file in a child process and resolves with its exit code. */
  readonly runWrapper: (file: string) => Promise<number>;
}

export const CONTROL_CASES: readonly ControlCase[] = [
  {
    name: 'clean',
    expected: EXIT_CLEAN,
    ifWrong: 'a clean fixture is reported as a failure, so a green leaks job would mean nothing',
  },
  {
    name: 'leaking',
    expected: EXIT_LEAKS,
    ifWrong: 'detached DOM nodes kept in a global array are not reported: memlab or the wrapper is blind to leaks',
  },
  {
    name: 'broken',
    expected: EXIT_ERROR,
    ifWrong: 'a scenario that cannot run does not end in the error code: an error could pass for a clean run',
  },
];

/** 0 when every case gave its expected exit code; 1 otherwise. Runs all cases either way, so one report shows every problem. */
export async function runControl(deps: ControlDeps): Promise<number> {
  let wrong = 0;
  for (const control of CONTROL_CASES) {
    const code = await deps.runWrapper(path.join(deps.directory, `${control.name}.ts`));
    if (code === control.expected) {
      deps.io.out(`control ${control.name}: exit code ${code}, as expected`);
    } else {
      wrong += 1;
      deps.io.err(`control ${control.name}: exit code ${code}, expected ${control.expected}: ${control.ifWrong}`);
    }
  }
  deps.io.out(
    wrong === 0 ? 'control: the wrapper fails when it must and passes when it may' : `control: ${wrong} case(s) wrong`,
  );
  return wrong === 0 ? 0 : 1;
}
