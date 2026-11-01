// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/postgres.ts start|stop` (yarn ci:postgres): the CI `postgres` job's database container. `start`
// runs the pinned postgres:18 image on a random free 127.0.0.1 port, waits until it is healthy and exports
// DATABASE_URL and CLA_PG_CONTAINER through the GITHUB_ENV file; `stop` removes the container and is idempotent.
// Logic-free on purpose: everything lives in lib/postgres-cli.ts and is tested there.
import process from 'node:process';
import { stdIo } from './lib/io.ts';
import { runPostgresCli } from './lib/postgres-cli.ts';
import { systemDeps } from './lib/postgres-deps.ts';

process.exitCode = await runPostgresCli(process.argv.slice(2), process.env, stdIo, systemDeps);
