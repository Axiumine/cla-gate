// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/mutation-gate/check-incremental.ts` (yarn mutate:check-incremental): deletes the incremental file of the
// shard in STRYKER_SHARD when Stryker cannot read it. Logic-free on purpose: everything lives in incremental-file.ts.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { runCheckIncremental } from './incremental-file.ts';

process.exitCode = runCheckIncremental(process.env, stdIo, path.resolve(import.meta.dirname, '../..'));
