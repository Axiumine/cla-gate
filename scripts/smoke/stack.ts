// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messageOf } from '../ci/lib/errors.ts';
import { bringUp } from './bring-up.ts';
import { composer, secretIn } from './compose.ts';
import { makeTemporaryDirectory } from './files.ts';
import { smokeRun, stackNames } from './names.ts';
import { prepare } from './prepare.ts';
import type { Stack, StackDeps, StackInfo, StackOptions } from './stack-types.ts';
import { removal } from './teardown.ts';

// E19-S08: one operator stack for the container smoke test. It runs the real docker-compose.yml and the real
// scripts/init-secrets.sh in a temporary directory, under a project name of its own, on a random loopback port; it is removed
// again, volumes and image included, whatever happened in between. Later scenarios (E19-S12) start more of them.

/** The handle of a stack that is up, made from what {@link StackInfo} says: the test files of Vitest's workers connect this way. */
export function connect(deps: StackDeps, info: StackInfo): Stack {
  const { saveLogs, down } = removal(deps, info.names, info.directory);
  return {
    ...info,
    url: `http://127.0.0.1:${info.port}`,
    compose: composer(deps, info.names, info.directory)(info.profiles, info.environment),
    docker: (args) => deps.exec('docker', args),
    secret: (name) => secretIn(info.directory, name),
    saveLogs,
    down,
  };
}

/**
 * Starts a stack for `options.scenario`: copies the compose file and the scripts it needs into a temporary directory, runs
 * `scripts/init-secrets.sh` there, sets the origin, the random port and the network in the dotenv file, and runs
 * `docker compose up --build --detach --wait`. When anything fails the stack is removed again before the error is thrown.
 */
export async function startStack(deps: StackDeps, options: StackOptions): Promise<Stack> {
  const names = stackNames(smokeRun(deps.env, deps.randomHex(4)), options.scenario);
  const directory = makeTemporaryDirectory();
  const profiles = (options.profiles ?? []).join(',');
  try {
    const dotenv = await prepare(deps, names, directory);
    const up = await bringUp(deps, composer(deps, names, directory), { ...options, directory, dotenv });
    return connect(deps, { names, directory, profiles, ...up });
  } catch (error) {
    const leftovers = await removal(deps, names, directory)
      .down()
      .then(
        () => '',
        (failure: unknown) => `\n${messageOf(failure)}`,
      );
    throw new Error(`${messageOf(error)}${leftovers}`, { cause: error });
  }
}
