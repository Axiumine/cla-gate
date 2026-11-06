// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Env } from '../ci/lib/env.ts';
import { collectIo } from '../ci/lib/test-support.ts';
import { SHARD_NAMES } from './shards.ts';
import { runSkipCli } from './skip-cli.ts';
import { jobNameOf } from './skip-decision.ts';
import { COMMIT, fakeGithub, githubOf, jobEntry, runEntry, skipEnv, TOKEN } from './test-support.ts';

// E20-S04: the step `decide` of the mutation job: one line, skip=true|false in GITHUB_OUTPUT, a line in the job summary for a
// skip, exit code 0 whatever happens.

const OUTPUT = '/runner/output';
const SUMMARY = '/runner/summary';
const PASSED = [jobEntry(jobNameOf('config'), 'success')];

/** Runs the step against a fake API and a fake file system; `failing` names the files whose append throws. */
async function step(env: Env, api = githubOf([runEntry(700)], { 700: PASSED }), failing: readonly string[] = []) {
  const { io, out, err } = collectIo();
  const files = new Map<string, string>();
  const code = await runSkipCli(env, io, {
    fetcher: api.fetcher,
    appendFile: (file, text) => {
      if (failing.includes(file)) {
        throw new Error(`cannot write ${file} with ${TOKEN}`);
      }
      files.set(file, `${files.get(file) ?? ''}${text}`);
    },
  });
  return { code, out, err, files, calls: api.calls };
}

const ENV = skipEnv({ GITHUB_OUTPUT: OUTPUT, GITHUB_STEP_SUMMARY: SUMMARY });

test('a pass of the shard by an earlier scheduled run prints one line, writes skip=true and adds the commit and the run to the summary', async () => {
  const result = await step(ENV);
  expect(result.code).toBe(0);
  expect(result.out).toEqual([
    `mutation skip check (config): skip, scheduled run 700 already passed mutation (config) on commit ${COMMIT}`,
  ]);
  expect(result.err).toEqual([]);
  expect(result.files.get(OUTPUT)).toBe('skip=true\n');
  expect(result.files.get(SUMMARY)).toBe(
    `Mutation shard \`config\` skipped: commit \`${COMMIT}\` already passed it in scheduled run 700, a forced run.\n`,
  );
});

test('no pass: one line, skip=false, nothing in the summary, exit code 0', async () => {
  const result = await step(ENV, githubOf([], {}));
  expect(result.code).toBe(0);
  expect(result.out).toEqual([
    `mutation skip check (config): run, no earlier scheduled run passed mutation (config) on commit ${COMMIT}`,
  ]);
  expect(result.files).toEqual(new Map([[OUTPUT, 'skip=false\n']]));
});

test.each(['workflow_dispatch', 'push'])('a %s run is never skipped, and the API is not asked', async (event) => {
  const result = await step(skipEnv({ GITHUB_OUTPUT: OUTPUT, GITHUB_STEP_SUMMARY: SUMMARY, GITHUB_EVENT_NAME: event }));
  expect(result.files).toEqual(new Map([[OUTPUT, 'skip=false\n']]));
  expect(result.calls).toEqual([]);
  expect(result.code).toBe(0);
});

test('a failing lookup runs the shard and still exits 0', async () => {
  const api = fakeGithub(() => ({ status: 503, body: {} }));
  const result = await step(ENV, api);
  expect(result.code).toBe(0);
  expect(result.files).toEqual(new Map([[OUTPUT, 'skip=false\n']]));
  expect(result.out).toEqual([
    'mutation skip check (config): run, the lookup did not give an answer (the list of runs: the API answered HTTP 503)',
  ]);
});

test('a shard that is not a shard runs (the next step rejects it loudly), says so in one line and exits 0', async () => {
  const result = await step(skipEnv({ GITHUB_OUTPUT: OUTPUT, STRYKER_SHARD: 'nope' }));
  expect(result.code).toBe(0);
  expect(result.out).toHaveLength(1);
  expect(result.out[0]).toBe(
    `mutation skip check (nope): run, STRYKER_SHARD must be one of ${SHARD_NAMES.join(', ')}, not "nope"`,
  );
  expect(result.files).toEqual(new Map([[OUTPUT, 'skip=false\n']]));
  expect(result.calls).toEqual([]);
});

test('outside Actions (no GITHUB_OUTPUT, no GITHUB_STEP_SUMMARY, or empty ones) the line is printed and no file is written', async () => {
  for (const names of [{}, { GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' }]) {
    const result = await step(skipEnv(names));
    expect(result.files).toEqual(new Map());
    expect(result.out[0]).toContain('skip, scheduled run 700');
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  }
});

test('a summary that cannot be written does not stop the output', async () => {
  const result = await step(ENV, undefined, [SUMMARY]);
  expect(result.files).toEqual(new Map([[OUTPUT, 'skip=true\n']]));
  expect(result.err).toEqual([]);
  expect(result.code).toBe(0);
});

test('an output that cannot be written is reported and exits 0: the unset output makes the later steps run', async () => {
  const result = await step(ENV, undefined, [OUTPUT]);
  expect(result.code).toBe(0);
  expect(result.err).toEqual([
    'mutation skip check: the GITHUB_OUTPUT file could not be written, so the later steps run',
  ]);
  expect(result.files.has(OUTPUT)).toBe(false);
});

test('the token is in no line that is printed or written, in any outcome', async () => {
  const outcomes = [
    await step(ENV),
    await step(ENV, githubOf([], {})),
    await step(
      ENV,
      fakeGithub(() => ({ status: 403, body: { message: TOKEN } })),
    ),
    await step(
      ENV,
      fakeGithub(() => new Error(`Bearer ${TOKEN}`)),
    ),
    await step(ENV, undefined, [OUTPUT]),
    await step(skipEnv({ GITHUB_OUTPUT: OUTPUT, STRYKER_SHARD: 'bad' })),
  ];
  for (const outcome of outcomes) {
    expect([...outcome.out, ...outcome.err, ...outcome.files.values()].join('\n')).not.toContain(TOKEN);
  }
});

test('control characters in the shard name cannot forge a log line', async () => {
  const result = await step(skipEnv({ STRYKER_SHARD: 'x\n::error::forged' }));
  expect(result.out.join('')).not.toMatch(/\p{Cc}/u);
  expect(result.out).toHaveLength(1);
});
