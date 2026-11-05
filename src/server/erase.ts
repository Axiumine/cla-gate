// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Entry point of `node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]` (or `node dist/server/erase.js` once built, E22-S05):
// the operator's erasure of a person's personal data, a dry run unless `--execute` is given. Logic-free on purpose: everything
// lives in adapters/db/erase-cli.ts and is tested there.
import process from 'node:process';
import { runEraseCli } from './adapters/db/erase-cli.ts';

process.exitCode = await runEraseCli({ argv: process.argv.slice(2), env: process.env });
