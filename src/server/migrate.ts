// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Entry point of `yarn db:migrate` (`node src/server/migrate.ts`, or `node dist/server/migrate.js` once built).
// Logic-free on purpose: everything lives in adapters/db/migrate-cli.ts and is tested there.
import path from 'node:path';
import process from 'node:process';
import { runMigrateCli } from './adapters/db/migrate-cli.ts';

process.exitCode = await runMigrateCli({
  env: process.env,
  directory: path.resolve(import.meta.dirname, '../../migrations'),
});
