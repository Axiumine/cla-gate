// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { exists } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ROOT, SCRIPTS, SEMGREP_BINARY } from './test-support.ts';

// E20-S01: "the first run over scripts/ and src/ ends with zero findings". The CI `semgrep` job is the gate that
// enforces it; this test shows the same with the offline copy of the rules (`yarn semgrep:rules`), so a change that adds
// a finding fails `yarn test` on a machine that has the binary and the rules. Skipped where either is missing (the
// coverage job has neither). The offline rules are a git-ignored download and are never committed.
//
// The scan takes about 15 s alone, but the same scan took 160 to 270 s inside the full suite on a busy development
// machine (Semgrep starts one process per core, next to every Vitest worker and whatever else runs). The limit only
// has to tell "slow" from "hung", so it is generous; the result still has to be zero findings and exit status 0.

const offlineRules = path.join(ROOT, 'rules');
const available = SEMGREP_BINARY !== undefined && exists(offlineRules);

test.skipIf(!available)(
  'the sources of the repository have no Semgrep finding',
  () => {
    const state = tempDir();
    const env = {
      PATH: process.env['PATH'],
      HOME: state,
      SEMGREP_SETTINGS_FILE: path.join(state, 'settings.yml'),
      SEMGREP_LOG_FILE: path.join(state, 'semgrep.log'),
    };
    const flags = (SCRIPTS.get('semgrep:offline') ?? '').replace(/^semgrep /, '').split(' ');
    const result = spawnSync(SEMGREP_BINARY ?? '', flags, { cwd: ROOT, env, encoding: 'utf8' });
    expect(result.stdout + result.stderr).not.toContain('Code Findings');
    expect(result.status).toBe(0);
  },
  600_000,
);
