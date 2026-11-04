// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Env } from '../ci/lib/env.ts';
import type { Exec, ExecResult } from '../ci/lib/exec.ts';
import type { StackNames } from './names.ts';

// E19-S08: the shapes of a smoke stack (stack.ts starts one, teardown.ts removes it).

export interface StackDeps {
  readonly exec: Exec;
  /** A random free loopback port above 32768 (scripts/ci/lib/ports.ts). */
  readonly pickPort: () => Promise<number>;
  /** A uniform integer from `min` to `max`, both included. */
  readonly randomInt: (min: number, max: number) => number;
  readonly randomHex: (bytes: number) => string;
  /** The checkout the stack is made from (also the build context). */
  readonly root: string;
  /** The environment of the process, for CLA_SMOKE_RUN. */
  readonly env: Env;
  /** Where the logs of a stack are written (reports/smoke, which the workflow uploads). */
  readonly logsDirectory: string;
}

export interface StackOptions {
  /** A short word (`boot`, `tls`) that makes the compose project name. */
  readonly scenario: string;
  /** Compose profiles to activate, such as `tls`. */
  readonly profiles?: readonly string[];
  /** Lines for .env besides the smoke test's own (the port, the origin, the network); these win. */
  readonly settings?: Readonly<Record<string, string>>;
  /**
   * Only these services are started and waited for (E19-S12); the rest is left to the scenario. The image is still built, so a
   * `docker compose run` of a service that is not started finds it. Empty or missing: every service of the active profiles.
   */
  readonly services?: readonly string[];
  /**
   * Names of dotenv settings (`CADDY_HTTP_PORT`) that each get a random free port above 32768 of their own, drawn again with
   * the application's port when one is taken (E19-S12). The ports end up in `environment`, so a scenario can read them.
   */
  readonly ports?: readonly string[];
  /** Keys added to a service in the compose override (`extra_hosts`), by service name (E19-S12). A name the compose file lacks is refused. */
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export type Run = (args: readonly string[]) => Promise<ExecResult>;

/** One shell script in, its outcome out. */
export type RunScript = (script: string) => Promise<ExecResult>;

/** What identifies a running stack and survives being copied to another process (Vitest's `provide` and `inject`). */
export interface StackInfo {
  readonly names: StackNames;
  /** The temporary directory that holds the compose file, `secrets/` and the dotenv file. */
  readonly directory: string;
  /** The host port the app is published on, on 127.0.0.1. */
  readonly port: number;
  /** The value of COMPOSE_PROFILES the stack runs with: `tls`, or empty. */
  readonly profiles: string;
  /** The settings the stack was started with, which outrank the shell's variables of the same name. */
  readonly environment: Readonly<Record<string, string>>;
}

export interface Stack extends StackInfo {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** `docker compose <args>` for this project, its files and its profiles. */
  readonly compose: Run;
  /** `docker <args>`, for what compose does not show (`inspect`). */
  readonly docker: Run;
  /** The content of `secrets/<name>` without its line break: for assertions about what must stay secret. */
  readonly secret: (name: string) => string;
  /**
   * Runs a shell script in the `work` directory of the stack's own directory, with `docker compose` standing for this project
   * (its name, files, profiles and settings) and `git` for the checkout, so that a command line of the operator guides runs as
   * the guide prints it (E19-S12). `set -eu` is on: the first failing line ends the script.
   */
  readonly shell: RunScript;
  /** Writes the redacted logs of every service to the log directory and returns the path. */
  readonly saveLogs: () => Promise<string>;
  /** Saves the logs, then `down --volumes`, removes the image and the temporary directory. Throws what failed, after doing the rest. */
  readonly down: () => Promise<void>;
}
