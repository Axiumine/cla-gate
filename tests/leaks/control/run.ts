// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { stdIo } from '../../../scripts/ci/lib/io.ts';
import { runChild } from '../../../scripts/dev/lib/child-runner.ts';
import { runControl } from '../../../scripts/leaks/control.ts';
import { CONTROL_DIR, WRAPPER } from '../../../scripts/leaks/paths.ts';

// E20-S07, `yarn leaks:control`: runs the wrapper (tests/leaks/run.ts) as a child process on the clean, the leaking and the
// broken scenario of this directory and compares each exit code with the one it must give. Exits 0 only when all three match.
// Logic-free and outside the coverage scope: the comparison is in scripts/leaks/control.ts (tested).
process.exitCode = await runControl({
  io: stdIo,
  directory: CONTROL_DIR,
  runWrapper: (file) => runChild(process.execPath, [WRAPPER, file], {}),
});
