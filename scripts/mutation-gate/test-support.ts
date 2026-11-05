// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import type { Mutant } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { z } from 'zod';
import { sourceTree } from '../../src/server/source-tree/test-support.ts';
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

// --------------------------------------------------------------------------- Stryker's instrumenter (the regular expression guard)

const quiet = (): void => undefined;
const never = (): boolean => false;

/** A logger that says nothing: the instrumenter writes a line for each run otherwise. */
const SILENT: Logger = {
  isTraceEnabled: never,
  isDebugEnabled: never,
  isInfoEnabled: never,
  isWarnEnabled: never,
  isErrorEnabled: never,
  isFatalEnabled: never,
  trace: quiet,
  debug: quiet,
  info: quiet,
  warn: quiet,
  error: quiet,
  fatal: quiet,
};

/** A file to instrument: the name it is known by and its text. */
export interface Source {
  readonly name: string;
  readonly content: string;
}

/** The mutants Stryker's own instrumenter makes of `sources`, with the options of a run: no mutator left out, no plugin. */
export async function mutantsOf(sources: readonly Source[]): Promise<readonly Mutant[]> {
  const { mutants } = await new Instrumenter(SILENT).instrument(
    sources.map(({ name, content }) => ({ name, content, mutate: true })),
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  return mutants;
}

/**
 * The regular expression literals that a mutant turns into a SyntaxError, one line each: file, line, the mutant and the
 * engine's message. Stryker writes every mutant of a file into the file behind a switch, so the module the tests load holds all
 * of them whichever one is active, and a literal that does not compile fails the load of the module and with it the initial test
 * run (`\v` became `\V`, which the `u` flag rejects: the dry run of 2026-11-04). A pattern passed to `new RegExp("...")` as a
 * string fails only while its mutant is active, which kills that mutant and fails nothing else, so only literals are checked.
 */
export function invalidRegexMutants(mutants: readonly Mutant[]): string[] {
  return mutants.flatMap((mutant) => {
    if (mutant.mutatorName !== 'Regex' || !mutant.replacement.startsWith('/')) {
      return [];
    }
    try {
      // Compiled, never run: the engine parses the literal as it does when it loads the module, and the text is a mutant of this
      // repository's own source.
      compileFunction(`return ${mutant.replacement};`);
      return [];
    } catch (error) {
      // Stryker counts lines from 0.
      return [`${mutant.fileName}:${mutant.location.start.line + 1}: ${mutant.replacement}: ${String(error)}`];
    }
  });
}

/**
 * The text of a file of the repository as it is written. Stryker runs the tests in a copy of the repository in which the mutated
 * files are already instrumented, and instrumenting that text again would not be the run that the guard stands for, so this reads
 * the repository itself (`sourceTree`).
 */
export function originalText(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: `file` is a path the test took from the listing of this repository's own folders
  return fs.readFileSync(path.join(sourceTree(ROOT), file), 'utf8');
}

/** The mutate globs of one scope of stryker.config.mjs, read from the config itself so that a new glob is guarded at once. */
async function mutateGlobs(scope: 'server' | 'scripts'): Promise<string[]> {
  // The config is plain JavaScript outside this project, so a literal import would have no types.
  // eslint-disable-next-line no-unsanitized/method -- the specifier is built from this repository's own root directory and a fixed file name
  const loaded: unknown = await import(pathToFileURL(path.join(ROOT, 'stryker.config.mjs')).href);
  const { strykerOptions } = z
    .object({ strykerOptions: z.custom<(scope: string) => unknown>((value) => typeof value === 'function') })
    .parse(loaded);
  return z.object({ mutate: z.array(z.string()) }).parse(strykerOptions(scope)).mutate;
}

/** Every file a full run of the gate mutates, relative to the repository root: the server scope (all shards) and the scripts scope. */
export async function filesTheGateMutates(): Promise<string[]> {
  return [
    ...mutated(await mutateGlobs('server'), ['src/server', 'src/shared']),
    ...mutated(await mutateGlobs('scripts'), ['scripts']),
  ];
}
