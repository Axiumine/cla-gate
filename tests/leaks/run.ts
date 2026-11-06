// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { ConsoleMode, config, run } from '@memlab/api';
import { chromium } from '@playwright/test';
import { stdIo } from '../../scripts/ci/lib/io.ts';
import { pickSystemFreePort } from '../../scripts/ci/lib/ports.ts';
import { answerTable } from '../../scripts/leaks/app-answers.ts';
import { serveApp } from '../../scripts/leaks/app-server.ts';
import { serveFixtures } from '../../scripts/leaks/fixture-server.ts';
import { APP_DIR, FIXTURES_DIR, REPORT_DIR, SCENARIOS_DIR } from '../../scripts/leaks/paths.ts';
import { runLeaks } from '../../scripts/leaks/runner.ts';
import { loadModule, systemFiles } from '../../scripts/leaks/system.ts';

// E20-S07, `yarn leaks`: runs every scenario of tests/leaks/scenarios (or the files named on the command line) through
// @memlab/api and sets the exit code: 0 clean, 1 a scenario leaked, 2 an error. Logic-free on purpose and outside the
// coverage scope: the decisions are in scripts/leaks/ (tested), and `yarn leaks:control` proves this file against a real browser.

// memlab's default is to call process.exit(1) on an error, which is the exit code of a leak. Throwing makes the error ours.
// 2 is ErrorHandling.Throw of @memlab/core, an enum that @memlab/api does not export.
Reflect.set(config, 'errorHandling', 2);

process.exitCode = await runLeaks(process.argv.slice(2), {
  io: stdIo,
  env: process.env,
  process,
  cwd: process.cwd(),
  places: { scenarios: SCENARIOS_DIR, fixtures: FIXTURES_DIR, report: REPORT_DIR },
  chromiumBinary: chromium.executablePath(),
  memlab: (options) => run({ ...options, consoleMode: ConsoleMode.SILENT }),
  load: loadModule,
  files: systemFiles,
  serve: (root) => serveFixtures(root, pickSystemFreePort),
  serveApp: () => serveApp({ root: APP_DIR, answers: answerTable() }, pickSystemFreePort),
});
