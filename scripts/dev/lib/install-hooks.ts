// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import type { Io } from '../../ci/lib/io.ts';
import { runChild } from './child-runner.ts';

// Git hooks belong on a developer's machine. On a persistent CI workspace they are harmful: `lefthook install` writes
// .git/hooks/post-checkout, and the next run's actions/checkout first deletes node_modules (`git clean -ffdx`) and then
// runs `git checkout`, which fires that hook; with `assert_lefthook_installed: true` the missing binary fails the
// checkout. CI repeats every check anyway (lefthook.yml), so it installs no hooks.

type Env = Readonly<Record<string, string | undefined>>;

export interface HookDeps {
  readonly exists: (file: string) => boolean;
  /** Runs a command with stdio inherited and resolves with its exit code. */
  readonly run: (command: string, args: readonly string[]) => Promise<number>;
}

/** GitHub Actions sets CI=true; `CI=` and `CI=0` or `CI=false` mean "not CI". */
const NOT_CI: ReadonlySet<string> = new Set(['', '0', 'false']);

export function isCi(env: Env): boolean {
  const value = env['CI'];
  return value !== undefined && !NOT_CI.has(value.trim().toLowerCase());
}

/** The real dependencies: `.git` on disk, and `lefthook` from the PATH that Yarn gives a package script. */
export const systemHookDeps: HookDeps = {
  exists: fs.existsSync,
  run: (command, args) => runChild(command, args, {}),
};

/**
 * Exit code 0 when the hooks are installed or deliberately skipped (CI, or no .git such as a Docker build context where
 * `lefthook install` would fail), otherwise the exit code of `lefthook install`.
 */
export async function installHooks(root: string, env: Env, deps: HookDeps, io: Io): Promise<number> {
  if (isCi(env)) {
    io.out('git hooks not installed: CI is set (docs/ci-runners.md, hygiene on a shared host)');
    return 0;
  }
  if (!deps.exists(path.join(root, '.git'))) {
    io.out('git hooks not installed: there is no .git here');
    return 0;
  }
  return deps.run('lefthook', ['install']);
}
