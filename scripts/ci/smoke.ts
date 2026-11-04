// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/smoke.ts stop` (yarn ci:smoke stop): the `if: always()` step of the CI `container` job. It removes what the
// container smoke test (`yarn smoke`, E19-S08) left on the shared Docker daemon when the job was cancelled: every compose
// project of the run, then every container, network, volume and image that carries the labels of the run. Logic-free on
// purpose: everything lives in scripts/smoke/ and is tested there.
import process from 'node:process';
import { runSmokeCli } from '../smoke/cli.ts';
import { cliDeps } from '../smoke/system.ts';
import { stdIo } from './lib/io.ts';

process.exitCode = await runSmokeCli(process.argv.slice(2), process.env, stdIo, cliDeps);
