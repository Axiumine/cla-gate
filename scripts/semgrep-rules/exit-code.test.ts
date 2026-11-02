// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { SCRIPTS, SEMGREP_BINARY } from './test-support.ts';

// E20-S01: "any finding makes the command exit non-zero", shown with the real binary and the flags of the real `semgrep`
// script, one local rule in place of the registry rule sets (so it needs no network). Skipped where Semgrep is not
// installed (the coverage job); the CI `semgrep` job installs it and runs the real scan.

const RULE =
  'rules:\n- id: demo.forbidden-call\n  pattern: forbidden()\n  message: demo\n  languages: [typescript]\n  severity: ERROR\n';

const binary = SEMGREP_BINARY;

/** Runs `yarn semgrep`'s own flags over a directory that holds `source`. */
function scan(source: string) {
  const dir = tempDir();
  makeRepo(dir, { 'rule.yaml': RULE, 'src/a.ts': source });
  const flags = (SCRIPTS.get('semgrep') ?? '')
    .replace(/^semgrep /, '')
    .replace(/--config \S+/g, '')
    .split(' ')
    .filter((flag) => flag !== '');
  const state = tempDir();
  const env = {
    PATH: process.env['PATH'],
    HOME: state,
    SEMGREP_SETTINGS_FILE: path.join(state, 'settings.yml'),
    SEMGREP_LOG_FILE: path.join(state, 'semgrep.log'),
  };
  const args = [...flags, '--config', path.join(dir, 'rule.yaml'), path.join(dir, 'src')];
  return spawnSync(binary ?? '', args, { env, encoding: 'utf8' });
}

test.skipIf(binary === undefined)('a finding makes the semgrep command exit with 1', () => {
  const result = scan('forbidden();\n');
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('demo.forbidden-call');
});

test.skipIf(binary === undefined)('a clean tree makes the semgrep command exit with 0', () => {
  expect(scan('allowed();\n').status).toBe(0);
});
