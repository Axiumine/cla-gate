// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// The root `postinstall` script of package.json: `lefthook install`, except where hooks must not exist. Logic-free on
// purpose: everything lives in lib/install-hooks.ts.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { installHooks, systemHookDeps } from './lib/install-hooks.ts';

const root = path.resolve(import.meta.dirname, '../..');

process.exitCode = await installHooks(root, process.env, systemHookDeps, stdIo);
