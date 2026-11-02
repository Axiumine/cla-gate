// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/e2e.ts run <command...>|stop` (yarn ci:e2e): runs a command in the pinned Playwright container of the CI
// `e2e` job, or removes that container. Logic-free on purpose: everything lives in lib/e2e-cli.ts and is tested there.
import process from 'node:process';
import { runE2eCli } from './lib/e2e-cli.ts';
import { systemDeps } from './lib/e2e-deps.ts';
import { stdIo } from './lib/io.ts';

process.exitCode = await runE2eCli(process.argv.slice(2), process.env, stdIo, systemDeps);
