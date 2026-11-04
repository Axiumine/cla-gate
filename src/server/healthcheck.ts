// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// The container's HEALTHCHECK command (`node dist/server/healthcheck.js`, E19-S01). Logic-free on purpose: everything lives
// in adapters/http/health-probe.ts and is tested there.
import process from 'node:process';
import { runHealthcheck } from './adapters/http/health-probe.ts';

process.exitCode = await runHealthcheck({
  env: process.env,
  fetch,
  err: (line) => process.stderr.write(`${line}\n`),
});
