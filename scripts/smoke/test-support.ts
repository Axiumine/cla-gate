// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach } from 'vitest';
import type { Exec, ExecResult } from '../ci/lib/exec.ts';
import { realExec } from '../ci/lib/exec.ts';
import { ok, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { removeDirectory } from './files.ts';
import type { Stack, StackDeps } from './stack-types.ts';

// What the tests of the smoke stack (E19-S08) share: a docker that is scripted, a checkout that is the real one, and the
// clean-up of the temporary directories a stack leaves when a test does not take it down.

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** What `drawSubnets` gives the default network for the smallest and the largest draw. */
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const FIRST_SUBNET = '172.16.0.0/24';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const LAST_SUBNET = '172.31.255.0/24';
/** The /24 that follows `FIRST_SUBNET` in its /16, and the one after `LAST_SUBNET`, which wraps within its /16. */
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const SECOND_SUBNET = '172.16.1.0/24';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private range written as data, not an address to connect to
export const WRAPPED_SUBNET = '172.31.0.0/24';

export interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>> | undefined;
}

/** The script `Stack.shell` (E19-S12) hands to `sh -c`, as the verb of that call. */
const SHELL = 'shell';

/** The verb of the call to the secrets script, which really runs. */
const INIT_SCRIPT = 'init-secrets';

/**
 * The compose verb of a `docker compose` call (`up`, `down`, `logs`), or the first word of any other docker call; `shell` for a
 * script given to `sh -c` and `init-secrets` for the run of scripts/init-secrets.sh.
 */
export function verbOf(call: Call): string {
  if (call.file === 'sh') {
    return call.args[0] === '-c' ? SHELL : INIT_SCRIPT;
  }
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

/** The verbs of the compose calls that start and stop the stack, in order. */
export function lifecycle(calls: readonly Call[]): string[] {
  return calls.map((call) => verbOf(call)).filter((verb) => verb === 'up' || verb === 'down');
}

/** The dotenv file of a stack's directory. */
export const DOTENV = '.env';

/** The settings of the dotenv file the stack wrote, as a map. */
export function settingsOf(directory: string): Map<string, string> {
  const lines = readText(path.join(directory, DOTENV))
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
  return new Map(
    lines.map((line): [string, string] => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
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

/** `StackDeps` for the real checkout with docker scripted: `sh` running the secrets script really runs, everything else is answered. */
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
    const verb = verbOf(call);
    if (verb === INIT_SCRIPT) {
      return realExec(file, args, env);
    }
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
