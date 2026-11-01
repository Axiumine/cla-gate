// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Pre-commit check - code caps, measured on the TypeScript AST, ratcheted against a baseline.
//
// Caps (a value ABOVE the cap is a violation):
//   file       500 lines
//   function    50 lines (decorators included)
//   class      300 lines (decorators included)
//   params       4 per function (a fake `this` parameter is not counted)
//   nesting      4 levels of if/for/while/do/try/switch/with inside one function
//
// Ratchet: violations already listed in `.code-caps-baseline.json` are tolerated as long as they do
// not GROW. A new violation, or a grown one, fails the check (exit 1) and blocks the commit.
//
//   node scripts/check-code-caps.ts                     # check the whole repo
//   node scripts/check-code-caps.ts --init              # create the baseline (first run only)
//   node scripts/check-code-caps.ts --update-baseline   # ratchet DOWN; never adds a violation
//
// Port of the user's `check_code_caps.py`; the logic lives in `scripts/code-caps/`.
import path from 'node:path';
import process from 'node:process';
import { main } from './code-caps/cli.ts';

process.exitCode = main(process.argv.slice(2), path.resolve(import.meta.dirname, '..'));
