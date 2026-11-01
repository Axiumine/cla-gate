// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/dev/db.ts up|url|down|run` (yarn db:up, db:url, db:down, and the wrapper of dev and db:migrate): the
// development database on a random free 127.0.0.1 port. Logic-free on purpose: everything lives in lib/.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { runDevDbCli, systemDeps } from './lib/dev-db-cli.ts';

const root = path.resolve(import.meta.dirname, '../..');

process.exitCode = await runDevDbCli(process.argv.slice(2), { root, env: process.env, deps: systemDeps, io: stdIo });
