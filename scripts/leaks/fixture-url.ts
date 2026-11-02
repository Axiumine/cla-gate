// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type Env, variable } from '../ci/lib/env.ts';

// E20-S07: a scenario never knows a port. The wrapper serves the fixtures on a random free loopback port and tells the
// scenarios where through this variable; a scenario asks for a fixture by file name.

export const ORIGIN_VARIABLE = 'LEAKS_ORIGIN';

/** `<origin>/<name>`; throws when no wrapper has set the origin, so a scenario run by hand fails loudly instead of loading nothing. */
export function fixtureUrl(name: string, env: Env = process.env): string {
  const origin = variable(env, ORIGIN_VARIABLE);
  if (origin === '') {
    throw new Error(
      `${ORIGIN_VARIABLE} is not set: run the scenarios with tests/leaks/run.ts, which serves the fixtures`,
    );
  }
  return `${origin}/${name}`;
}
