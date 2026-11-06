// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario } from '@memlab/api';
import type { Env } from '../ci/lib/env.ts';
import type { Io } from '../ci/lib/io.ts';
import type { ExitTarget } from './exit-guard.ts';
import type { FixtureServer } from './fixture-server.ts';

// E20-S07: everything the wrapper needs from the outside. Every effect (memlab, the browser path, importing a file, the file
// system, the server, the process) comes in through `LeakDeps`, so the exit codes are tested without a browser;
// tests/leaks/run.ts supplies the real ones and `yarn leaks:control` proves them against a real Chromium.

export interface MemlabOptions {
  readonly scenario: IScenario;
  /** A directory that exists: memlab writes its heap snapshots there. */
  readonly workDir: string;
  readonly chromiumBinary: string;
  /** The fixtures are local files: loading the page once before measuring would only cost a minute. */
  readonly skipWarmup: boolean;
}

export interface MemlabResult {
  /** One serialized trace per leak (memlab's `RunResult.leaks`). */
  readonly leaks: readonly Readonly<Record<string, unknown>>[];
}

export interface LeakDeps {
  readonly io: Io;
  /** `process.env`: the wrapper writes the origins into it, for `fixtureUrl()` and `appUrl()` in the scenarios. */
  readonly env: Env;
  readonly process: ExitTarget;
  readonly cwd: string;
  readonly places: { readonly scenarios: string; readonly fixtures: string; readonly report: string };
  readonly chromiumBinary: string;
  readonly memlab: (options: MemlabOptions) => Promise<MemlabResult>;
  readonly load: (file: string) => Promise<unknown>;
  readonly files: {
    readonly list: (directory: string) => readonly string[];
    readonly makeDirectory: (directory: string) => void;
    readonly write: (file: string, text: string) => void;
  };
  readonly serve: (root: string) => Promise<FixtureServer>;
  /** E18-S12: the built dashboard and its made-up API, on a port of their own. */
  readonly serveApp: () => Promise<FixtureServer>;
}
