// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Test helpers for E20-S02: scratch repositories with chosen commit dates, and the commands that the repository itself
// runs (package.json scripts, lefthook jobs and CI steps). Nothing here may depend on a Trivy binary: the coverage job has
// none, and helpers that only a skipped test would call would break its 100% gate (they live in real-trivy.test.ts).
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import { exists } from '../ci/lib/test-support.ts';
import { activeLines, repoText, SCRIPTS, workflows } from '../semgrep-rules/test-support.ts';

/** Stages everything in `root` and commits it as of `iso` (author and committer date). */
export function commitAt(root: string, iso: string, message: string): void {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
  const run = (...args: string[]) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is looked up on PATH on purpose; the argv is fixed
    execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
  };
  if (!exists(path.join(root, '.git'))) {
    run('init', '--quiet');
  }
  run('add', '--all');
  run('-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '--quiet', '--message', message);
}

/** A moment `days` after `iso`, as an ISO text. */
export function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

/** Absolute path of the real `trivy` binary on the PATH, or undefined where it is not installed. */
export const TRIVY_BINARY = String(process.env['PATH'])
  .split(path.delimiter)
  .map((directory) => path.join(directory, 'trivy'))
  .find(exists);

/** The arguments of one `trivy` command line from the repository (everything after the binary name). */
export function trivyArgs(command: string): string[] {
  return command.trim().split(/\s+/).slice(1);
}

/** Each command of an `a && b` script, trimmed. */
export function commandsOf(script: string): string[] {
  return script.split('&&').map((command) => command.trim());
}

/** Every command line the repository runs: package.json scripts, lefthook `run:` values and CI `run:` steps. */
export function allCommands(): string[] {
  const runs = workflows().flatMap((flow) =>
    Object.values(flow.jobs).flatMap((job) => job.steps.map((step) => step.run ?? '')),
  );
  const hookRuns = activeLines(repoText('lefthook.yml'))
    .filter((line) => /^(?:- )?run:/.test(line))
    .map((line) => line.replace(/^(?:- )?run:\s*/, ''));
  return [...SCRIPTS.values(), ...hookRuns, ...runs].flatMap(commandsOf);
}

/** A repository file parsed as YAML (an untyped tree: the caller validates it with zod). */
export function yamlOf(file: string): unknown {
  return parse(repoText(file));
}
