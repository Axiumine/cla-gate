// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { expression, findOnPath, readText } from './lib/test-support.ts';

// The required check `coverage` is a merge job. The whole suite under V8 coverage did not fit the 45 minutes the single job had
// on the slowest shared runner (2026-11-06), and the runner guard caps a job at 60 (R4), so the matrix `coverage-shard` runs a
// quarter of the suite per leg (`vitest run --coverage --shard=i/4 --reporter=blob`) and `coverage` merges the four blobs with
// `vitest run --merge-reports --coverage`, which applies the 100% thresholds of vitest.config.ts to the MERGED coverage. This file
// pins the parts a mistake would turn into a green check without 100% coverage: a skipped required job counts as passing, a
// blob from another runner does not merge unless the workspace path is neutral, and a missing shard must be refused by name.

const ROOT = path.resolve(import.meta.dirname, '../..');
const SHARDS = 4;
const BLOBS = 'reports/coverage-blob';
const PLACEHOLDER = '@@GITHUB_WORKSPACE@@';

const stepSchema = z.object({
  name: z.string(),
  uses: z.string().optional(),
  run: z.string().optional(),
  shell: z.string().optional(),
  if: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  'continue-on-error': z.unknown().optional(),
});
const jobSchema = z.object({
  name: z.string(),
  needs: z.unknown().optional(),
  if: z.string().optional(),
  'runs-on': z.tuple([z.literal('self-hosted'), z.literal('Linux'), z.literal('X64')]),
  'timeout-minutes': z.number(),
  strategy: z.unknown().optional(),
  'continue-on-error': z.unknown().optional(),
  steps: z.array(stepSchema),
});
const parsed: unknown = parse(readText(path.join(ROOT, '.github/workflows/ci.yml')));
const jobs = new Map(Object.entries(z.object({ jobs: z.record(z.string(), z.unknown()) }).parse(parsed).jobs));

const shard = jobSchema.parse(jobs.get('coverage-shard'));
const merge = jobSchema.parse(jobs.get('coverage'));
const shardNames = shard.steps.map((each) => each.name);
const mergeNames = merge.steps.map((each) => each.name);

function stepOf(job: typeof shard, name: string) {
  const found = job.steps.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`no step ${name}`);
  }
  return found;
}

const GUARD = 'Require every shard to have passed';
const TESTS = 'Tests of this shard with coverage';
const NEUTRAL = 'Make the blob independent of the workspace path';
const UPLOAD_BLOB = 'Upload the blob report of this shard';
const DOWNLOAD = 'Download the blob reports of the shards';
const REQUIRE_BLOBS = 'Require the blob of every shard';
const RESTORE = 'Put the workspace path back into the blobs';
const MERGE = 'Merge the shard reports and enforce 100% coverage';
const UPLOAD_LCOV = 'Upload the lcov report for Qodana';

/** Runs a step's script the way the runner does (`bash -eo pipefail`), in `cwd`, and returns the exit code and the output. */
function bash(script: string, cwd: string, env: Readonly<Record<string, string>>) {
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd,
    env: { PATH: String(process.env['PATH']), ...env },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('coverage-shard is a matrix of four legs that fail independently, on the shared runners, with a timeout of its own', () => {
  expect(shard.name).toBe(`coverage shard (${expression('matrix.index')}/${SHARDS})`);
  expect(shard.strategy).toEqual({ 'fail-fast': false, matrix: { index: [1, 2, 3, 4] } });
  expect(shard['timeout-minutes']).toBeGreaterThanOrEqual(30);
  expect(shard['timeout-minutes']).toBeLessThanOrEqual(40);
  expect(shard.needs).toBeUndefined();
  expect(shard.if).toBeUndefined();
  expect(shard['continue-on-error']).toBeUndefined();
  expect(shardNames.slice(0, 2)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
  ]);
});

test('a leg runs its quarter with coverage and the blob reporter, and turns off the thresholds only for itself', () => {
  const tests = stepOf(shard, TESTS);
  expect(tests.run).toBe(
    `yarn vitest run --coverage --shard="$SHARD/${SHARDS}" --reporter=default --reporter=github-actions --reporter=blob --outputFile.blob="${BLOBS}/blob-$SHARD-${SHARDS}.json" --coverage.reporter=text-summary --coverage.thresholds.100=false`,
  );
  expect(tests.env).toEqual({ CI: '1', SHARD: expression('matrix.index') });
  expect(tests['continue-on-error']).toBeUndefined();
  // Nothing but the thresholds of a quarter is turned off, and nowhere else: not the files that count, not the metrics.
  const everything = shard.steps.map((each) => each.run ?? '').join('\n');
  expect(everything.match(/--coverage\.thresholds/g)).toHaveLength(1);
  expect(everything).not.toMatch(/--coverage\.(include|exclude)/);
});

test('the shard count is one number: the matrix, the --shard argument, the blob names and what the merge job expects', () => {
  const counted = /--shard="\$SHARD\/(\d+)"/.exec(String(stepOf(shard, TESTS).run));
  expect(Number(counted?.[1])).toBe(SHARDS);
  const names = z
    .object({ index: z.array(z.number()) })
    .parse(z.object({ matrix: z.unknown() }).parse(shard.strategy).matrix);
  expect(names.index).toEqual(Array.from({ length: SHARDS }, (_value, offset) => offset + 1));
  expect(stepOf(merge, REQUIRE_BLOBS).env).toEqual({ SHARD_COUNT: String(SHARDS) });
  expect(stepOf(shard, UPLOAD_BLOB).with?.['path']).toBe(`${BLOBS}/blob-${expression('matrix.index')}-${SHARDS}.json`);
});

test('a leg uploads its blob under its own name for a day, and fails when there is none', () => {
  const upload = stepOf(shard, UPLOAD_BLOB);
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.with).toEqual({
    name: `coverage-blob-${expression('matrix.index')}`,
    path: `${BLOBS}/blob-${expression('matrix.index')}-${SHARDS}.json`,
    'retention-days': 1,
    'if-no-files-found': 'error',
    overwrite: true,
  });
  expect(shardNames.at(-1)).toBe(UPLOAD_BLOB);
  expect(shardNames.at(-2)).toBe(NEUTRAL);
  expect(shardNames.at(-3)).toBe(TESTS);
});

test('coverage keeps the exact name the branch protection requires, waits for the shards, and runs whatever they ended as', () => {
  expect(merge.name).toBe('coverage');
  expect(merge.needs).toBe('coverage-shard');
  // A skipped required job counts as passing, and a job with `needs` is skipped when a needed job fails or is cancelled.
  expect(merge.if).toBe(expression('always()'));
  expect(merge.strategy).toBeUndefined();
  expect(merge['continue-on-error']).toBeUndefined();
  expect(merge['timeout-minutes']).toBeLessThanOrEqual(15);
  expect(mergeNames.slice(0, 3)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    GUARD,
  ]);
});

test('the step after the preflight fails the job unless every shard ended as success, and runs before anything is installed', () => {
  const guard = stepOf(merge, GUARD);
  expect(guard.env).toEqual({ SHARDS_RESULT: expression('needs.coverage-shard.result') });
  expect(guard.if).toBeUndefined();
  expect(guard['continue-on-error']).toBeUndefined();
  expect(mergeNames.indexOf(GUARD)).toBeLessThan(mergeNames.indexOf('Check out the repository'));
  // The only value that lets the job go on is 'success'. 'skipped' is what a required job would report if the shards were
  // skipped, and '' is a result the job does not get at all; both are refused too.
  for (const result of ['failure', 'cancelled', 'skipped', '', 'Success', 'success ']) {
    const run = bash(String(guard.run), tempDir(), { SHARDS_RESULT: result });
    expect(run.code, `result ${JSON.stringify(result)}`).toBe(1);
    expect(run.out).toContain(`::error title=Coverage::the coverage shards ended as '${result}', not 'success'`);
  }
  expect(bash(String(guard.run), tempDir(), { SHARDS_RESULT: 'success' })).toEqual({ code: 0, out: '' });
});

test('the merge applies the thresholds of vitest.config.ts to the merged blobs and changes none of them', () => {
  const run = stepOf(merge, MERGE);
  expect(run.run).toBe(`yarn vitest run --merge-reports=${BLOBS} --coverage`);
  expect(run.env).toEqual({ CI: '1' });
  expect(run['continue-on-error']).toBeUndefined();
  expect(run.if).toBeUndefined();
  const everything = merge.steps.map((each) => each.run ?? '').join('\n');
  expect(everything).not.toMatch(/thresholds|--coverage\.(include|exclude)|passWithNoTests|\|\|\s*true/);
  // The report that Qodana reads is the merged one, uploaded last, under the name and with the layout it always had.
  expect(mergeNames.indexOf(MERGE)).toBe(mergeNames.length - 2);
  expect(mergeNames.at(-1)).toBe(UPLOAD_LCOV);
  expect(stepOf(merge, UPLOAD_LCOV).with).toEqual({
    name: 'coverage-lcov',
    path: 'coverage/lcov.info',
    'retention-days': 7,
    'if-no-files-found': 'error',
  });
});

test('the blobs of the shards are downloaded into one directory, and only those artifacts', () => {
  const download = stepOf(merge, DOWNLOAD);
  expect(download.uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/);
  expect(download.with).toEqual({ pattern: 'coverage-blob-*', 'merge-multiple': true, path: BLOBS });
  expect(mergeNames.indexOf(DOWNLOAD)).toBeLessThan(mergeNames.indexOf(REQUIRE_BLOBS));
  expect(mergeNames.indexOf(REQUIRE_BLOBS)).toBeLessThan(mergeNames.indexOf(RESTORE));
  expect(mergeNames.indexOf(RESTORE)).toBeLessThan(mergeNames.indexOf(MERGE));
});

/** A workspace with the given files under reports/coverage-blob. */
function workspaceWith(blobs: Readonly<Record<string, string>>): string {
  const workspace = tempDir();
  makeRepo(workspace, Object.fromEntries(Object.entries(blobs).map(([file, text]) => [`${BLOBS}/${file}`, text])));
  return workspace;
}

const ALL_BLOBS = Object.fromEntries(
  Array.from({ length: SHARDS }, (_value, offset) => [`blob-${offset + 1}-${SHARDS}.json`, '[]']),
);

test('the merge needs the blob of every shard by name: a missing one, an empty one or an extra entry fails, and names what is missing', () => {
  const script = String(stepOf(merge, REQUIRE_BLOBS).run);
  const env = { SHARD_COUNT: String(SHARDS) };
  expect(bash(script, workspaceWith(ALL_BLOBS), env)).toEqual({ code: 0, out: '' });

  const withoutThird = Object.fromEntries(Object.entries(ALL_BLOBS).filter(([name]) => name !== 'blob-3-4.json'));
  const missing = bash(script, workspaceWith(withoutThird), env);
  expect(missing.code).toBe(1);
  expect(missing.out).toContain(
    `::error title=Coverage::expected the blobs of ${SHARDS} shards in ${BLOBS}; missing: 3/${SHARDS}; entries found: 3`,
  );

  const empty = bash(script, workspaceWith({ ...ALL_BLOBS, 'blob-2-4.json': '' }), env);
  expect(empty.code).toBe(1);
  expect(empty.out).toContain(`missing: 2/${SHARDS}; entries found: 4`);

  const extra = bash(script, workspaceWith({ ...ALL_BLOBS, 'blob-5-4.json': '[]' }), env);
  expect(extra.code).toBe(1);
  expect(extra.out).toContain('missing: none; entries found: 5');

  const folder = bash(script, workspaceWith({ ...withoutThird, 'coverage-blob-3/blob-3-4.json': '[]' }), env);
  expect(folder.code).toBe(1);
  expect(folder.out).toContain(`missing: 3/${SHARDS}`);
});

/** A blob as the blob reporter writes it for this purpose: absolute paths of one workspace, in several places. */
function blobOf(workspace: string): string {
  return JSON.stringify([
    '5.0.5',
    [{ filepath: `${workspace}/src/a.test.ts` }],
    { [`${workspace}/src/a.ts`]: { path: `${workspace}/src/a.ts`, s: { 0: 1 } } },
    { root: workspace, outside: '/opt/other/src/a.ts' },
  ]);
}

test('a blob made in one workspace merges in another: the path goes out in the leg and the merge job puts its own back', () => {
  const made = '/home/runner-a/_work/cla-gate/cla-gate';
  const merged = '/srv/runner.b/_work/cla-gate/cla-gate';
  const home = workspaceWith({ 'blob-1-4.json': blobOf(made) });
  const leg = bash(String(stepOf(shard, NEUTRAL).run), home, { GITHUB_WORKSPACE: made, SHARD: '1' });
  expect(leg).toEqual({ code: 0, out: '' });
  const neutral = readText(path.join(home, BLOBS, 'blob-1-4.json'));
  expect(neutral).toBe(blobOf(PLACEHOLDER));
  expect(neutral).not.toContain(made);

  const elsewhere = workspaceWith({ 'blob-1-4.json': neutral, 'blob-2-4.json': neutral });
  const back = bash(String(stepOf(merge, RESTORE).run), elsewhere, { GITHUB_WORKSPACE: merged });
  expect(back).toEqual({ code: 0, out: '' });
  for (const file of ['blob-1-4.json', 'blob-2-4.json']) {
    expect(readText(path.join(elsewhere, BLOBS, file))).toBe(blobOf(merged));
  }
});

test('a dot in the workspace path matches a dot and nothing else, in the leg', () => {
  const workspace = '/home/r.unner/_work/x/x';
  const dir = workspaceWith({
    'blob-2-4.json': JSON.stringify([`${workspace}/a.ts`, '/home/rXunner/_work/x/x/b.ts']),
  });
  const run = bash(String(stepOf(shard, NEUTRAL).run), dir, { GITHUB_WORKSPACE: workspace, SHARD: '2' });
  expect(run.code).toBe(0);
  expect(readText(path.join(dir, BLOBS, 'blob-2-4.json'))).toBe(
    JSON.stringify([`${PLACEHOLDER}/a.ts`, '/home/rXunner/_work/x/x/b.ts']),
  );
});

test('a leg whose blob has no workspace path to neutralise fails, instead of uploading a blob that merges wrong', () => {
  const workspace = '/home/runner/_work/cla-gate/cla-gate';
  const dir = workspaceWith({ 'blob-1-4.json': JSON.stringify(['/somewhere/else.ts']) });
  const run = bash(String(stepOf(shard, NEUTRAL).run), dir, { GITHUB_WORKSPACE: workspace, SHARD: '1' });
  expect(run.code).toBe(1);
  expect(run.out).toContain(
    `::error title=Coverage blob::${BLOBS}/blob-1-4.json does not hold the workspace path exactly as a placeholder`,
  );
});

test.each([
  ['a space', '/home/run ner/_work/x'],
  ['a pipe', '/home/run|ner/_work/x'],
  ['an ampersand', '/home/run&ner/_work/x'],
  ['a backslash', '/home/run\\ner/_work/x'],
  ['a quote', '/home/run"ner/_work/x'],
])('a workspace path with %s is refused by both steps, because sed would read it as syntax', (_label, workspace) => {
  const dir = workspaceWith({ 'blob-1-4.json': '[]' });
  const leg = bash(String(stepOf(shard, NEUTRAL).run), dir, { GITHUB_WORKSPACE: workspace, SHARD: '1' });
  expect(leg.code).toBe(1);
  expect(leg.out).toContain(
    '::error title=Coverage blob::the workspace path has a character this step does not handle',
  );
  const back = bash(String(stepOf(merge, RESTORE).run), dir, { GITHUB_WORKSPACE: workspace });
  expect(back.code).toBe(1);
  expect(back.out).toContain(
    '::error title=Coverage blob::the workspace path has a character this step does not handle',
  );
  expect(readText(path.join(dir, BLOBS, 'blob-1-4.json'))).toBe('[]');
});

test('only the coverage legs upload blobs and only the coverage job downloads them, and nothing else downloads the lcov report but qodana', () => {
  const uses = (kind: string) =>
    [...jobs]
      .filter(([, job]) => JSON.stringify(job).includes(`actions/${kind}-artifact@`))
      .map(([id]) => id)
      .toSorted((a, b) => a.localeCompare(b));
  const blobUsers = [...jobs]
    .filter(([, job]) => JSON.stringify(job).includes('coverage-blob'))
    .map(([id]) => id)
    .toSorted((a, b) => a.localeCompare(b));
  expect(blobUsers).toEqual(['coverage', 'coverage-shard']);
  expect(uses('download')).toEqual(['coverage', 'qodana']);
  expect(uses('upload')).toEqual(expect.arrayContaining(['coverage', 'coverage-shard']));
  const lcovUsers = [...jobs]
    .filter(([, job]) => JSON.stringify(job).includes('coverage-lcov'))
    .map(([id]) => id)
    .toSorted((a, b) => a.localeCompare(b));
  expect(lcovUsers).toEqual(['coverage', 'qodana']);
});
