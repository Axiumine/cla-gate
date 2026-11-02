// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { defineConfig } from '@playwright/test';
import { pickSystemFreePort } from './scripts/ci/lib/ports.ts';
import {
  appEnvironment,
  isCi,
  MAX_DIFF_PIXELS,
  PORT_VARIABLE,
  SNAPSHOT_PATH_TEMPLATE,
  serverPort,
} from './scripts/e2e/settings.ts';

// E20-S06. Browser tests against the built server (`yarn build` first) on a migrated PostgreSQL (DATABASE_URL). Logic-free
// on purpose: every decision lives in scripts/e2e/settings.ts and is tested there; scripts/e2e/config.test.ts loads this
// file and pins the result. Screenshots are compared only inside the pinned container (e2e/global-setup.ts, yarn e2e:update).
const port = await serverPort(process.env, pickSystemFreePort);
// Every worker loads this file again: the variable makes them agree with this process on the port.
Reflect.set(process.env, PORT_VARIABLE, String(port));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: SNAPSHOT_PATH_TEMPLATE,
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixels: MAX_DIFF_PIXELS } },
  // Playwright's own default is `missing`, which writes a baseline whenever one is absent: a run must opt in with --update-snapshots.
  updateSnapshots: 'none',
  retries: 0,
  workers: 1,
  forbidOnly: isCi(process.env),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'yarn start',
    url: `${baseURL}/healthz`,
    env: appEnvironment({ env: process.env, port, randomHex: (bytes) => randomBytes(bytes).toString('hex') }),
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
