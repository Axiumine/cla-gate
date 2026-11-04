// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import path from 'node:path';
import { printable } from '../../code-caps/types.ts';
import type { Env } from './env.ts';
import { reportLines } from './errors.ts';
import type { ExecResult } from './exec.ts';
import type { Io } from './io.ts';
import type { TrivyInstallDeps } from './trivy-install-deps.ts';
import { type Plan, planOf } from './trivy-install-plan.ts';

// The `trivy` job of .github/workflows/ci.yml installs Trivy with this module (E20-S02). The release is fetched straight
// from GitHub, and what is unpacked is only what matches the SHA-256 that ci.yml spells out, so a changed or swapped
// archive stops the job and no download from any other host is involved. A test keeps the version equal to mise.toml's.

/** HTTPS only, also across redirects (the release asset is served from another GitHub host), three retries for a flaky network. */
const CURL_FLAGS = [
  '--fail',
  '--silent',
  '--show-error',
  '--location',
  '--retry',
  '3',
  '--proto',
  '=https',
  '--proto-redir',
  '=https',
];

/** The result of a command that must have succeeded, or an error with its exit code and what it printed on stderr. */
function succeeded(result: ExecResult, what: string): ExecResult {
  if (result.code !== 0) {
    throw new Error(`${what} failed with exit code ${result.code}: ${result.stderr.trim()}`);
  }
  return result;
}

/** Downloads the archive, refuses it unless it is the pinned one, and unpacks only the `trivy` binary. */
async function fetchBinary(plan: Plan, io: Io, deps: TrivyInstallDeps): Promise<void> {
  succeeded(await deps.exec('curl', [...CURL_FLAGS, '--output', plan.archive, plan.url]), 'curl');
  const digest = createHash('sha256').update(deps.readFile(plan.archive)).digest('hex');
  if (digest !== plan.sha256) {
    throw new Error(`SHA-256 of ${plan.url} is ${digest}, not the pinned ${plan.sha256}: nothing was unpacked`);
  }
  io.out(`${plan.url} matches the pinned SHA-256`);
  succeeded(await deps.exec('tar', ['-xzf', plan.archive, '-C', plan.directory, 'trivy']), 'tar');
}

async function install(plan: Plan, io: Io, deps: TrivyInstallDeps): Promise<void> {
  deps.makeDirectory(plan.directory);
  try {
    await fetchBinary(plan, io, deps);
  } finally {
    deps.removeFile(plan.archive);
  }
  const { stdout } = succeeded(await deps.exec(path.join(plan.directory, 'trivy'), ['--version']), 'trivy --version');
  io.out(`installed ${printable(stdout.split('\n', 1).join(''))} in ${plan.directory}`);
  deps.appendFile(plan.pathFile, `${plan.directory}\n`);
}

/**
 * Installs the Trivy release named by INSTALL_TRIVY_VERSION into `$RUNNER_TEMP/trivy` and adds that directory to GITHUB_PATH.
 * Exit code: 0 installed, 1 anything else (a bad setting, a failed download, a digest that is not the pinned one, a binary
 * that does not run). The PATH entry is written last, so a failed install leaves the next steps without Trivy.
 */
export async function runTrivyInstall(env: Env, io: Io, deps: TrivyInstallDeps): Promise<number> {
  try {
    await install(planOf(env), io, deps);
    return 0;
  } catch (error) {
    reportLines('install-trivy', 'install', error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
