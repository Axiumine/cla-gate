// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// The command that `yarn dev` runs through `scripts/dev/db.ts run app` (E17-S01): the Fastify dev server and the Vite dev
// server together. Logic-free on purpose: everything lives in lib/dev-servers.ts.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { systemServersDeps } from './lib/dev-children.ts';
import { runDevServers } from './lib/dev-servers.ts';

const root = path.resolve(import.meta.dirname, '../..');

process.exitCode = await runDevServers({ root, env: process.env, deps: systemServersDeps, io: stdIo });
