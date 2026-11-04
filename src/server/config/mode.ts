// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConfigIssue } from './config-issue.ts';

// The two modes of the server (E19-S02): `normal`, with the GitHub App configured, and `setup`, where no App exists yet and
// the first-run flow (E19-S06) creates it. The mode follows from which of the five App variables are set.

/** The variables that together configure the GitHub App; all five make `normal` mode, none of them is `setup` mode. */
export const GITHUB_APP_VARIABLES = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

export type Mode = 'setup' | 'normal';

/** What the mode is decided from: the environment after the first parse, where an unset variable is undefined. */
export interface ModeEnv {
  readonly NODE_ENV: string;
  readonly SETUP_TOKEN?: unknown;
  readonly GITHUB_APP_ID?: unknown;
  readonly GITHUB_APP_PRIVATE_KEY?: unknown;
  readonly GITHUB_WEBHOOK_SECRET?: unknown;
  readonly GITHUB_CLIENT_ID?: unknown;
  readonly GITHUB_CLIENT_SECRET?: unknown;
}

/** What the setup mode needs and cannot do without: the one-time token that unlocks the first-run flow. */
const SETUP_TOKEN_REQUIRED: ConfigIssue = {
  variable: 'SETUP_TOKEN',
  rule: 'required while no GitHub App is configured; set it, or set the GITHUB_* variables',
};

/** The App variables that are not set, in the order of {@link GITHUB_APP_VARIABLES}; none when the App is configured. */
export function missingAppVariables(env: ModeEnv): readonly (typeof GITHUB_APP_VARIABLES)[number][] {
  const values = new Map<string, unknown>(Object.entries(env));
  return GITHUB_APP_VARIABLES.filter((name) => values.get(name) === undefined);
}

const PARTIAL_RULE = 'required: some GitHub App variables are set, so all five are needed (or none, for setup mode)';

/**
 * The mode, and what is wrong with the settings that decide it.
 *
 * - All five App variables set: `normal`.
 * - None set: `setup`, and in production `SETUP_TOKEN` is required (setup mode never starts without a token).
 * - Some set: `normal`, and in production each missing variable is an issue of its own.
 *
 * Outside production the App variables stay individually optional, as before (E05-S01, E10-S01): a development server, the
 * end-to-end server and most tests run with part of an App, or none. There `setup` means no App and a `SETUP_TOKEN` offered
 * (a developer who wants the first-run flow sets one); without a token a server with no App is `normal`, as it always was.
 */
export function resolveMode(env: ModeEnv): { readonly mode: Mode; readonly problems: readonly ConfigIssue[] } {
  const production = env.NODE_ENV === 'production';
  const missing = missingAppVariables(env);
  if (missing.length === GITHUB_APP_VARIABLES.length) {
    if (env.SETUP_TOKEN !== undefined) {
      return { mode: 'setup', problems: [] };
    }
    return production ? { mode: 'setup', problems: [SETUP_TOKEN_REQUIRED] } : { mode: 'normal', problems: [] };
  }
  const partial = production ? missing.map((variable) => ({ variable, rule: PARTIAL_RULE })) : [];
  return { mode: 'normal', problems: partial };
}
