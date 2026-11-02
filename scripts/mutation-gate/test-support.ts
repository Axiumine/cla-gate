// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import type { Env } from '../ci/lib/env.ts';
import { expression } from '../ci/lib/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import type { Shard } from './shards.ts';
import type { Fetcher, HttpInit } from './skip-http.ts';

/** Every file below `directory`, relative to the repository root, with forward slashes. */
export function filesBelow(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a directory of the repository
  const entries = fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory() ? filesBelow(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
}

/** Whether one file is selected by `mutate` patterns: a positive glob matches it and no `!` glob does. */
export function isMutated(file: string, patterns: readonly string[]): boolean {
  const include = patterns.filter((pattern) => !pattern.startsWith('!'));
  const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return (
    include.some((pattern) => path.matchesGlob(file, pattern)) &&
    !exclude.some((pattern) => path.matchesGlob(file, pattern))
  );
}

/** What the `mutate` patterns select among the files below `roots`. */
export function mutated(patterns: readonly string[], roots: readonly string[]): string[] {
  return roots.flatMap(filesBelow).filter((file) => isMutated(file, patterns));
}

/** The names of the shards whose globs select `file` once `exclusions` are applied: exactly one when the file is assigned. */
export function ownersOf(file: string, shards: readonly Shard[], exclusions: readonly string[]): string[] {
  return shards.filter((shard) => isMutated(file, [...shard.mutate, ...exclusions])).map((shard) => shard.name);
}

// --------------------------------------------------------------------------- a fake GitHub API for the skip decision (E20-S04)

/** A request the fake saw. */
export interface Call {
  readonly url: URL;
  readonly init: HttpInit;
}

/** What the fake answers: a status with a JSON body, a body that is not JSON, or a failure of the request itself. */
export type Reply =
  | Error
  | { readonly status: number; readonly body: unknown }
  | { readonly status: number; readonly notJson: true };

/** A `fetch` whose answers come from `route`; every call is recorded. */
export function fakeGithub(route: (url: URL) => Reply): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const reply = route(parsed);
    if (reply instanceof Error) {
      return Promise.reject(reply);
    }
    const json =
      'notJson' in reply
        ? () => Promise.reject(new SyntaxError('Unexpected token'))
        : () => Promise.resolve(reply.body);
    return Promise.resolve({ status: reply.status, json });
  };
  return { fetcher, calls };
}

export const COMMIT = 'a1'.repeat(20);
export const OTHER_COMMIT = 'b2'.repeat(20);
export const CURRENT_RUN = 900;
export const TOKEN = 'ghs_TOKEN-that-must-never-be-printed';

/** The environment of a scheduled run of the `config` shard; `over` replaces or, with undefined, removes variables. */
export function skipEnv(over: Readonly<Record<string, string | undefined>> = {}): Env {
  return {
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: 'Axiumine/cla-gate',
    GITHUB_SHA: COMMIT,
    GITHUB_RUN_ID: String(CURRENT_RUN),
    GITHUB_EVENT_NAME: 'schedule',
    STRYKER_SHARD: 'config',
    GITHUB_TOKEN: TOKEN,
    ...over,
  };
}

/** A completed scheduled run of ci.yml for `COMMIT`, the way the API lists it. */
export function runEntry(id: number, over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id, head_sha: COMMIT, event: 'schedule', status: 'completed', conclusion: 'failure', ...over };
}

/** A job of a run, the way the API lists it. */
export function jobEntry(name: string, conclusion: string | null, status = 'completed'): Record<string, unknown> {
  return { id: 1, name, status, conclusion };
}

/** The page of `items` that the request asks for (`page`, 1-based, `per_page` items each). */
function pageOf<T>(items: readonly T[], url: URL): T[] {
  const size = Number(url.searchParams.get('per_page'));
  const start = (Number(url.searchParams.get('page')) - 1) * size;
  return items.slice(start, start + size);
}

/** A fake of the two endpoints: `runs` is the whole list of runs, `jobs` the whole list of jobs of each run (404 for any other). */
export function githubOf(runs: readonly unknown[], jobs: Readonly<Record<number, readonly unknown[]>>) {
  return fakeGithub((url) => {
    if (url.pathname.endsWith('/actions/workflows/ci.yml/runs')) {
      return { status: 200, body: { total_count: runs.length, workflow_runs: pageOf(runs, url) } };
    }
    // The path is .../actions/runs/<id>/jobs.
    const list = new Map(Object.entries(jobs)).get(String(url.pathname.split('/').at(-2)));
    return list === undefined
      ? { status: 404, body: { message: 'Not Found' } }
      : { status: 200, body: { total_count: list.length, jobs: pageOf(list, url) } };
  });
}

/** The condition every step of a mutation leg after `decide` carries, and the form of it that still lets a step run after a failure. */
export const GATE = expression("steps.decide.outputs.skip != 'true'");
export const ALWAYS_GATE = expression("always() && steps.decide.outputs.skip != 'true'");
