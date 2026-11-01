// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Prints one random free port in 32769..60999 (probed on 127.0.0.1): `node scripts/ci/free-port.ts` (yarn ci:port).
// Logic-free on purpose: everything lives in lib/free-port-cli.ts and is tested there.
import process from 'node:process';
import { runFreePortCli } from './lib/free-port-cli.ts';
import { stdIo } from './lib/io.ts';

process.exitCode = await runFreePortCli(stdIo);
