// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach } from 'vitest';
import type { Exec, ExecResult } from '../ci/lib/exec.ts';
import { realExec } from '../ci/lib/exec.ts';
import { ok } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { removeDirectory } from './files.ts';
import type { Stack, StackDeps } from './stack-types.ts';

// What the tests of the smoke stack (E19-S08) share: a docker that is scripted, a checkout that is the real one, and the
// clean-up of the temporary directories a stack leaves when a test does not take it down.

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** What `randomSubnet` returns for the smallest and the largest draw. */
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const FIRST_SUBNET = '172.16.0.0/24';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const LAST_SUBNET = '172.31.255.0/24';

export interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>> | undefined;
}

/** The compose verb of a `docker compose` call (`up`, `down`, `logs`), or the first word of any other docker call. */
export function verbOf(call: Call): string {
  const [first = '', ...rest] = call.args;
  if (first !== 'compose') {
    return first;
  }
  const words = [...rest];
  while (words[0]?.startsWith('--')) {
    words.splice(0, 2);
  }
  return words[0] ?? '';
}

export interface Script {
  /** Replies per verb, in order; the last one repeats. A verb that is not scripted succeeds with no output. */
  readonly replies?: Readonly<Record<string, readonly ExecResult[]>>;
  readonly ports?: readonly number[];
  readonly env?: Readonly<Record<string, string>>;
}

const stacks: Stack[] = [];

afterEach(() => {
  for (const stack of stacks.splice(0)) {
    removeDirectory(stack.directory);
  }
});

/** Remembers a stack so that its temporary directory is removed after the test even if the test did not take it down. */
export function track(stack: Stack): Stack {
  stacks.push(stack);
  return stack;
}

/** `StackDeps` for the real checkout with docker scripted: `sh` (the secrets script) really runs, everything else is answered. */
export function scripted(script: Script = {}): {
  readonly deps: StackDeps;
  readonly calls: Call[];
  readonly logs: string;
} {
  const calls: Call[] = [];
  const used = new Map<string, number>();
  const replies = new Map(Object.entries(script.replies ?? {}));
  const ports = [...(script.ports ?? [40_001, 40_002, 40_003, 40_004, 40_005, 40_006])];
  const logs = tempDir();
  const exec: Exec = (file, args, env) => {
    const call = { file, args, env };
    calls.push(call);
    if (file === 'sh') {
      return realExec(file, args, env);
    }
    const verb = verbOf(call);
    const queue = replies.get(verb) ?? [];
    const index = used.get(verb) ?? 0;
    used.set(verb, index + 1);
    return Promise.resolve(queue.at(Math.min(index, queue.length - 1)) ?? ok());
  };
  const deps: StackDeps = {
    exec,
    pickPort: () => Promise.resolve(ports.shift() ?? 40_999),
    randomInt: (min) => min,
    randomHex: () => 'abcd1234',
    root: ROOT,
    env: script.env ?? {},
    logsDirectory: logs,
  };
  return { deps, calls, logs };
}

/** The calls whose verb is `verb`. */
export function callsOf(calls: readonly Call[], verb: string): Call[] {
  return calls.filter((call) => verbOf(call) === verb);
}
