// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/check-escape-hatches.ts` (yarn lint:hatches, part of yarn lint): the escape-hatch justification gate of
// E20-S16. It scans the source files of the repository and fails on an explicit `any`, an `as` assertion other than
// `as const`, a coverage-ignore comment, a type-coverage ignore comment or a Qodana noinspection comment (E20-S08) that
// carries no written reason. Exit codes: 0 ok, 1 findings, 2 unusable input. Logic-free on purpose: everything lives in
// escape-hatches/cli.ts.
import path from 'node:path';
import process from 'node:process';
import { stdIo } from './ci/lib/io.ts';
import { main } from './escape-hatches/cli.ts';

process.exitCode = main(process.argv.slice(2), path.resolve(import.meta.dirname, '..'), stdIo);
