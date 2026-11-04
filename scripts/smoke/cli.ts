// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { Env } from '../ci/lib/env.ts';
import { variable } from '../ci/lib/env.ts';
import { reportLines } from '../ci/lib/errors.ts';
import type { Exec } from '../ci/lib/exec.ts';
import type { Io } from '../ci/lib/io.ts';
import { printable } from '../code-caps/types.ts';
import { removeRun } from './cleanup.ts';
import { RUN_VARIABLE, smokeRun } from './names.ts';

// E19-S08: `node scripts/ci/smoke.ts stop` (yarn ci:smoke stop), the `if: always()` step of the `container` job.

const USAGE = ['usage: ci-smoke stop'];

export interface SmokeCliDeps {
  readonly exec: Exec;
}

/**
 * Exit code: 0 ok (nothing recorded, or everything of the run removed), 1 failure, 2 usage. The run comes from CLA_SMOKE_RUN,
 * which the workflow set before the test started; without it the test made a name of its own and removed its stacks itself.
 */
export async function runSmokeCli(argv: readonly string[], env: Env, io: Io, deps: SmokeCliDeps): Promise<number> {
  if (argv.length !== 1 || argv[0] !== 'stop') {
    USAGE.forEach((line) => {
      io.err(line);
    });
    return 2;
  }
  if (variable(env, RUN_VARIABLE) === '') {
    io.out(`no run recorded in ${RUN_VARIABLE}: nothing to remove`);
    return 0;
  }
  try {
    const run = smokeRun(env, '');
    const removed = await removeRun(deps.exec, run);
    io.out(
      `run ${printable(run)}: ${removed.projects.length} compose projects down, removed ${removed.containers} containers, ` +
        `${removed.networks} networks, ${removed.volumes} volumes and ${removed.images} images that were left`,
    );
    return 0;
  } catch (error) {
    reportLines('ci-smoke', 'stop', error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
