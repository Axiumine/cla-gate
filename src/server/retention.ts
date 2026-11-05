// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Entry point of `node src/server/retention.ts [--dry-run]` (or `node dist/server/retention.js` once built, E22-S04): the retention
// sweep by hand. Logic-free on purpose: everything lives in adapters/db/retention-cli.ts and is tested there.
import process from 'node:process';
import { runRetentionCli } from './adapters/db/retention-cli.ts';

process.exitCode = await runRetentionCli({ argv: process.argv.slice(2), env: process.env });
