// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';

// E20-S07: where the leak scenarios, their pages and their reports live. Absolute, so the result never depends on the
// directory the command was started from.

const ROOT = path.resolve(import.meta.dirname, '../..');
const LEAKS = path.join(ROOT, 'tests/leaks');

/** `*.ts` files that default-export a scenario; `yarn leaks` runs every one. */
export const SCENARIOS_DIR = path.join(LEAKS, 'scenarios');
/** The deliberately leaking, clean and broken scenarios of `yarn leaks:control`. */
export const CONTROL_DIR = path.join(LEAKS, 'control');
/** The `*.html` pages the fixture server serves. */
export const FIXTURES_DIR = path.join(LEAKS, 'fixtures');
/** The wrapper itself: the control runs it as a child process, to see the exit code a real run gives. */
export const WRAPPER = path.join(LEAKS, 'run.ts');
/** git-ignored; per scenario, `leaks.json` (the traces) and `memlab/` (heap snapshots). CI uploads it when the job fails. */
export const REPORT_DIR = path.join(ROOT, 'reports/leaks');
/** E18-S12: the built dashboard (`yarn build`), which the scenarios of the screens load. A missing build is a 404 of the page, not of the run. */
export const APP_DIR = path.join(ROOT, 'dist/web');
