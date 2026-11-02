// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';
import { commandsOf, plusDays, TRIVY_BINARY, trivyArgs } from './test-support.ts';

// E20-S02: the flags of the real scripts, run with the real Trivy over scratch directories. Everything here works offline
// (the secret scanner needs no database, and the Dockerfile checks ship inside the binary), so a missing network cannot
// turn "exit code 1" into a false pass. Skipped where Trivy is not installed (the coverage job): the CI trivy job installs
// it and runs the real scan over the repository. These tests add assertions; no line depends on them for its coverage.

/** A made-up GitHub token that Trivy's secret scanner recognises; assembled at run time so no source file holds it whole. */
function fakeToken(): string {
  return ['ghp_', 'aB3dE5gH7jK9mN1p', 'Q3rS5tU7vW9xY1zA3bC5'].join('');
}

/**
 * Runs the real Trivy with `args` in `cwd`, offline: an empty cache, no version check, the checks that ship inside the
 * binary and no progress bar. Its home directory is scratch space too.
 */
function runTrivy(args: readonly string[], cwd: string) {
  const state = tempDir();
  const env = {
    PATH: process.env['PATH'],
    HOME: state,
    TRIVY_CACHE_DIR: path.join(state, 'cache'),
    TRIVY_SKIP_VERSION_CHECK: 'true',
    TRIVY_SKIP_CHECK_UPDATE: 'true',
    TRIVY_NO_PROGRESS: 'true',
  };
  return spawnSync(TRIVY_BINARY ?? 'trivy', [...args], { cwd, env, encoding: 'utf8' });
}

/** Milliseconds for a test that starts the real Trivy more than once: the default 5 s is too short on a loaded machine. */
const SLOW = 60_000;

const SECRETS_SCRIPT = trivyArgs(SCRIPTS.get('trivy:secrets') ?? '');
const SECOND_COMMAND_ARGS = trivyArgs(commandsOf(SCRIPTS.get('trivy') ?? '')[1] ?? '');
const JSON_FLAGS = ['--format', 'json', '--quiet'];
const reportSchema = z.object({
  Results: z
    .array(
      z.object({
        Target: z.string(),
        Secrets: z.array(z.object({ RuleID: z.string() })).optional(),
        Misconfigurations: z.array(z.object({ ID: z.string() })).optional(),
      }),
    )
    .optional(),
});

/** A scratch project with the repository's trivy.yaml and the given files; `files` are written below its root. */
function project(files: Readonly<Record<string, string>>): string {
  const root = tempDir();
  makeRepo(root, { 'trivy.yaml': repoText('trivy.yaml'), ...files });
  return root;
}

/** Targets Trivy reported a secret or a misconfiguration for, from a JSON run with the given script flags. */
function findings(flags: readonly string[], root: string) {
  const result = runTrivy([...flags, ...JSON_FLAGS], root);
  const report = reportSchema.parse(JSON.parse(result.stdout));
  const targets = (report.Results ?? []).filter(
    (entry) => (entry.Secrets?.length ?? 0) > 0 || (entry.Misconfigurations?.length ?? 0) > 0,
  );
  return {
    status: result.status,
    targets: targets.map((entry) => entry.Target).sort((a, b) => a.localeCompare(b, 'en')),
    report,
  };
}

const TOKEN_LINE = () => `token = ${fakeToken()}\n`;

test.skipIf(TRIVY_BINARY === undefined)('yarn trivy:secrets fails the run on a secret and names the rule', () => {
  const root = project({ 'config.txt': TOKEN_LINE() });
  const { status, report } = findings(SECRETS_SCRIPT, root);
  expect(status).toBe(1);
  expect(report.Results?.[0]?.Secrets?.[0]?.RuleID).toBe('github-pat');
});

test.skipIf(TRIVY_BINARY === undefined)('yarn trivy:secrets passes a tree without a secret', () => {
  expect(findings(SECRETS_SCRIPT, project({ 'config.txt': 'token = none\n' })).status).toBe(0);
});

test.skipIf(TRIVY_BINARY === undefined)('trivy.yaml skips the listed directories at the root and nothing else', () => {
  const skipped = [
    '.yarn',
    'coverage',
    'dist',
    'build',
    'reports',
    '.stryker-tmp',
    '.vitest',
    'playwright-report',
    'test-results',
    'rules',
  ];
  const files = Object.fromEntries(
    [...skipped, 'node_modules/pkg', 'a/b/node_modules/pkg', 'src/coverage', 'src/rules', 'src/dist', 'docs'].map(
      (directory) => [path.join(directory, 'token.txt'), TOKEN_LINE()],
    ),
  );
  const { targets } = findings(SECRETS_SCRIPT, project(files));
  expect(targets).toEqual(['docs/token.txt', 'src/coverage/token.txt', 'src/dist/token.txt', 'src/rules/token.txt']);
});

test.skipIf(TRIVY_BINARY === undefined)(
  'the second pass fails the run on a Dockerfile misconfiguration and passes a good one',
  () => {
    const bad = findings(SECOND_COMMAND_ARGS, project({ Dockerfile: 'FROM alpine:3.20\nRUN echo hi\n' }));
    expect(bad.status).toBe(1);
    expect(bad.report.Results?.[0]?.Misconfigurations?.map((each) => each.ID)).toContain('DS-0002');
    const good = findings(
      SECOND_COMMAND_ARGS,
      project({ Dockerfile: 'FROM alpine:3.20\nUSER nobody\nHEALTHCHECK CMD true\n' }),
    );
    expect(good.status).toBe(0);
    expect(good.targets).toEqual([]);
  },
  SLOW,
);

test.skipIf(TRIVY_BINARY === undefined)('the second pass also fails on a secret, whatever its severity', () => {
  expect(findings(SECOND_COMMAND_ARGS, project({ 'config.txt': TOKEN_LINE() })).status).toBe(1);
});

/** `.trivyignore` text that ignores the fixture token's rule until `iso`, with a reason above it. */
const ignoreUntil = (iso: string) => `# made-up test token\ngithub-pat exp:${iso.slice(0, 10)}\n`;

test.skipIf(TRIVY_BINARY === undefined)(
  'an entry is honoured until its expiry day and not on it: what the expiry check relies on',
  () => {
    const now = new Date().toISOString();
    const run = (iso: string) =>
      findings(SECRETS_SCRIPT, project({ 'config.txt': TOKEN_LINE(), '.trivyignore': ignoreUntil(iso) })).status;
    expect(run(plusDays(now, 2))).toBe(0);
    expect(run(now)).toBe(1);
    expect(run(plusDays(now, -1))).toBe(1);
  },
  SLOW,
);
