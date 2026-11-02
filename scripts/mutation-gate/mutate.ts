// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/mutation-gate/mutate.ts [--all | <shard>] [stryker options]` (yarn mutate, yarn mutate:shard): runs the
// mutation gate shard by shard. Logic-free on purpose: everything lives in mutate-cli.ts and is tested there.
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { runMutateCli } from './mutate-cli.ts';
import { systemDeps } from './mutate-run.ts';

process.exitCode = await runMutateCli(process.argv.slice(2), process.env, stdIo, systemDeps);
