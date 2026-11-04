// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/caddy.ts validate [origin...]|stop` (yarn ci:caddy): the CI `caddy` job's check of docker/Caddyfile. `validate`
// runs `caddy validate` in a short-lived container of the pinned Caddy image, once per https origin, with no network and no
// published port; `stop` removes that container (it is already gone unless the job was cancelled) and is idempotent.
// Logic-free on purpose: everything lives in lib/caddy-cli.ts and is tested there.
import process from 'node:process';
import { runCaddyCli } from './lib/caddy-cli.ts';
import { systemDeps } from './lib/caddy-deps.ts';
import { stdIo } from './lib/io.ts';

process.exitCode = await runCaddyCli(process.argv.slice(2), process.env, stdIo, systemDeps);
