// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/check-runners.ts` (yarn ci:runners): the runner guard of docs/ci-runners.md. It reads every .yml and
// .yaml file in .github/workflows and fails when a job could run somewhere the policy does not allow. Exit codes:
// 0 ok, 1 violations, 2 unusable input. Logic-free on purpose: everything lives in lib/guard-cli.ts.
import path from 'node:path';
import process from 'node:process';
import { main } from './lib/guard-cli.ts';
import { stdIo } from './lib/io.ts';

process.exitCode = main(process.argv.slice(2), path.resolve(import.meta.dirname, '../..'), stdIo);
