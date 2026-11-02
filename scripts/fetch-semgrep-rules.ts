// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/fetch-semgrep-rules.ts` (yarn semgrep:rules): E20-S01. Downloads the five Semgrep rule sets named in
// the `semgrep` script into rules/<name>.yaml, the offline copy that `yarn semgrep:offline` scans with. rules/ is
// git-ignored on purpose (the Semgrep Rules License v1.0 restricts redistribution). Exit codes: 0 ok, 1 a download or
// a write failed (nothing is written), 2 bad argument. Logic-free on purpose: everything lives in semgrep-rules/.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from './ci/lib/io.ts';
import { main } from './semgrep-rules/cli.ts';

process.exitCode = await main(process.argv.slice(2), path.resolve(import.meta.dirname, '../rules'), stdIo, fetch);
