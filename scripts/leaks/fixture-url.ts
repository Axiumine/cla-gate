// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type Env, variable } from '../ci/lib/env.ts';

// E20-S07: a scenario never knows a port. The wrapper serves the fixtures on a random free loopback port and tells the
// scenarios where through this variable; a scenario asks for a fixture by file name.

export const ORIGIN_VARIABLE = 'LEAKS_ORIGIN';
/** E18-S12: the same for the built dashboard, which the wrapper serves on a port of its own. */
export const APP_ORIGIN_VARIABLE = 'LEAKS_APP_ORIGIN';

/** `<origin>/<rest>` for the origin in `variableName`; throws when no wrapper has set it, so a scenario run by hand fails loudly instead of loading nothing. */
function urlOn(variableName: string, rest: string, env: Env): string {
  const origin = variable(env, variableName);
  if (origin === '') {
    throw new Error(`${variableName} is not set: run the scenarios with tests/leaks/run.ts, which serves the pages`);
  }
  return `${origin}/${rest}`;
}

/** `<origin>/<name>` of a fixture page. */
export function fixtureUrl(name: string, env: Env = process.env): string {
  return urlOn(ORIGIN_VARIABLE, name, env);
}

/** The address of a screen of the dashboard: `appUrl('installations/9001/documents')`, no leading slash. */
export function appUrl(screen: string, env: Env = process.env): string {
  return urlOn(APP_ORIGIN_VARIABLE, screen, env);
}
