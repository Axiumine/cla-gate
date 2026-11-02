// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Env } from '../ci/lib/env.ts';
import { SHARD_NAMES } from './shards.ts';
import { decide, jobNameOf, LOOKUP_TIMEOUT_MS } from './skip-decision.ts';
import { MAX_RUNS } from './skip-github.ts';
import { MAX_PAGES, PER_PAGE } from './skip-http.ts';
import { COMMIT, CURRENT_RUN, githubOf, jobEntry, OTHER_COMMIT, runEntry, skipEnv, TOKEN } from './test-support.ts';

// E20-S04: the skip decision of the nightly mutation run. A shard is skipped only when an earlier completed scheduled run of
// the same commit has the job `mutation (<shard>)` concluded `success`. The API is a fake; the failure paths are in
// skip-failures.test.ts.

const NAME = jobNameOf('config');
const PASSED = [jobEntry('static', 'success'), jobEntry(NAME, 'success'), jobEntry(jobNameOf('http'), 'failure')];
const NO_PASS = `run, no earlier scheduled run passed ${NAME} on commit ${COMMIT}`;

/** Decides over a fake API that holds `runs` and the jobs of each run. */
async function decided(
  runs: readonly unknown[],
  jobs: Readonly<Record<number, readonly unknown[]>>,
  env: Env = skipEnv(),
) {
  const github = githubOf(runs, jobs);
  const decision = await decide(env, github.fetcher);
  return { decision, calls: github.calls, urls: github.calls.map((call) => call.url.href) };
}

/** `count` entries that are not the job looked for. */
function filler(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => jobEntry(`other job ${index}`, 'success'));
}

test('a scheduled run of the same commit that passed the shard skips it, and the message names the run, the shard and the commit', async () => {
  const { decision } = await decided([runEntry(700)], { 700: PASSED });
  expect(decision).toEqual({
    skip: true,
    runId: 700,
    sha: COMMIT,
    message: `skip, scheduled run 700 already passed ${NAME} on commit ${COMMIT}`,
  });
});

test('it asks for the completed scheduled runs of the commit in ci.yml, then for the jobs of a run, with GET and the token only in the header', async () => {
  const { urls, calls } = await decided([runEntry(700)], { 700: PASSED });
  const api = 'https://api.github.com/repos/Axiumine/cla-gate/actions';
  expect(urls).toEqual([
    `${api}/workflows/ci.yml/runs?head_sha=${COMMIT}&event=schedule&status=completed&per_page=100&page=1`,
    `${api}/runs/700/jobs?per_page=100&page=1`,
  ]);
  for (const call of calls) {
    expect(call.init.method).toBe('GET');
    expect(call.init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(call.url.href).not.toContain(TOKEN);
  }
});

test('without a token the requests are anonymous, which is enough for a public repository', async () => {
  const { calls, decision } = await decided([runEntry(700)], { 700: PASSED }, skipEnv({ GITHUB_TOKEN: undefined }));
  expect(decision.skip).toBe(true);
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.init.headers).toEqual({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  }
});

test('the API root may have a path and a trailing slash, as on a GitHub Enterprise server', async () => {
  const { urls } = await decided(
    [runEntry(700)],
    { 700: PASSED },
    skipEnv({ GITHUB_API_URL: 'https://ghe.example.com/api/v3/' }),
  );
  expect(urls[0]).toMatch(
    /^https:\/\/ghe\.example\.com\/api\/v3\/repos\/Axiumine\/cla-gate\/actions\/workflows\/ci\.yml\/runs\?/,
  );
  expect(urls[1]).toBe(
    'https://ghe.example.com/api/v3/repos/Axiumine/cla-gate/actions/runs/700/jobs?per_page=100&page=1',
  );
});

test.each(SHARD_NAMES)(
  'the job looked for is the one of the shard: only a pass of mutation (%s) skips it',
  async (shard) => {
    const own = await decided(
      [runEntry(700)],
      { 700: [jobEntry(jobNameOf(shard), 'success')] },
      skipEnv({ STRYKER_SHARD: shard }),
    );
    expect(own.decision.skip).toBe(true);
    const others = SHARD_NAMES.filter((name) => name !== shard).map((name) => jobEntry(jobNameOf(name), 'success'));
    const other = await decided([runEntry(700)], { 700: others }, skipEnv({ STRYKER_SHARD: shard }));
    expect(other.decision).toEqual({
      skip: false,
      message: `run, no earlier scheduled run passed ${jobNameOf(shard)} on commit ${COMMIT}`,
    });
  },
);

test.each(['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'stale', null])(
  'a job that concluded %j is not a pass: the shard runs',
  async (conclusion) => {
    const { decision } = await decided([runEntry(700)], { 700: [jobEntry(NAME, conclusion)] });
    expect(decision).toEqual({ skip: false, message: NO_PASS });
  },
);

test('a job that is not completed is not a pass, whatever its conclusion field says', async () => {
  for (const status of ['in_progress', 'queued', 'waiting']) {
    const { decision } = await decided([runEntry(700)], { 700: [jobEntry(NAME, 'success', status)] });
    expect(decision).toEqual({ skip: false, message: NO_PASS });
  }
});

test.each([
  ['no job at all', []],
  ['other jobs only', [jobEntry('static', 'success'), jobEntry('coverage', 'success')]],
  ['the name of another shard', [jobEntry(jobNameOf('http'), 'success')]],
  ['the bare job name', [jobEntry('mutation', 'success')]],
  ['a name with a suffix', [jobEntry(`${NAME} `, 'success')]],
  ['a name with another case', [jobEntry('Mutation (config)', 'success')]],
  ['a name that only starts like it', [jobEntry('mutation (config)x', 'success')]],
])('a run without the job (%s) did not pass the shard', async (_what, jobs) => {
  const { decision } = await decided([runEntry(700)], { 700: jobs });
  expect(decision).toEqual({ skip: false, message: NO_PASS });
});

test('no run at all, or a run of another commit, does not skip, and no job is read for a run that does not count', async () => {
  expect((await decided([], {})).decision).toEqual({ skip: false, message: NO_PASS });
  const other = await decided([runEntry(700, { head_sha: OTHER_COMMIT })], { 700: PASSED });
  expect(other.decision).toEqual({ skip: false, message: NO_PASS });
  expect(other.calls).toHaveLength(1);
});

test.each([
  ['a push run', { event: 'push' }],
  ['a manual run', { event: 'workflow_dispatch' }],
  ['a pull request run', { event: 'pull_request' }],
  ['a run that is in progress', { status: 'in_progress' }],
  ['a run that is queued', { status: 'queued' }],
])('%s does not count, even with a green job in it, and its jobs are not read', async (_what, over) => {
  const { decision, calls } = await decided([runEntry(700, over)], { 700: PASSED });
  expect(decision).toEqual({ skip: false, message: NO_PASS });
  expect(calls).toHaveLength(1);
});

test('the run that is asking is never its own evidence', async () => {
  const alone = await decided([runEntry(CURRENT_RUN)], { [CURRENT_RUN]: PASSED });
  expect(alone.decision).toEqual({ skip: false, message: NO_PASS });
  expect(alone.calls).toHaveLength(1);
  const both = await decided([runEntry(CURRENT_RUN), runEntry(700)], { [CURRENT_RUN]: PASSED, 700: PASSED });
  expect(both.decision).toMatchObject({ skip: true, runId: 700 });
});

test('runs are read newest first and the search stops at the first pass', async () => {
  const first = await decided([runEntry(700), runEntry(600)], { 700: PASSED, 600: PASSED });
  expect(first.decision).toMatchObject({ skip: true, runId: 700 });
  expect(first.urls).toHaveLength(2);
  const second = await decided([runEntry(700), runEntry(600)], { 700: [jobEntry(NAME, 'failure')], 600: PASSED });
  expect(second.decision).toMatchObject({ skip: true, runId: 600 });
  expect(second.urls).toHaveLength(3);
});

test.each(['workflow_dispatch', 'push', 'pull_request', 'release', ''])(
  'the event %j never skips, and nothing is asked of the API',
  async (event) => {
    const { decision, calls } = await decided([runEntry(700)], { 700: PASSED }, skipEnv({ GITHUB_EVENT_NAME: event }));
    expect(decision).toEqual({
      skip: false,
      message: `run, the event is ${JSON.stringify(event)}, and only the nightly schedule can skip`,
    });
    expect(calls).toEqual([]);
  },
);

test('an unset event never skips either', async () => {
  const { decision, calls } = await decided(
    [runEntry(700)],
    { 700: PASSED },
    skipEnv({ GITHUB_EVENT_NAME: undefined }),
  );
  expect(decision.skip).toBe(false);
  expect(calls).toEqual([]);
});

test('the list of runs is read page by page: a pass on the second page skips, and a run list that ends on a full page asks once more', async () => {
  const elsewhere = Array.from({ length: PER_PAGE }, (_, index) => runEntry(1000 + index, { head_sha: OTHER_COMMIT }));
  const found = await decided([...elsewhere, runEntry(700)], { 700: PASSED });
  expect(found.decision).toMatchObject({ skip: true, runId: 700 });
  expect(found.calls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '2', '1']);
  const none = await decided(elsewhere, {});
  expect(none.decision).toEqual({ skip: false, message: NO_PASS });
  expect(none.calls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '2']);
});

test('the jobs of a run are read page by page too', async () => {
  const { decision, calls } = await decided([runEntry(700)], { 700: [...filler(PER_PAGE), jobEntry(NAME, 'success')] });
  expect(decision).toMatchObject({ skip: true, runId: 700 });
  expect(calls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '1', '2']);
});

test(`more than ${MAX_PAGES} full pages of runs is a cap: the search stops, fails open, and asks for no fourth page`, async () => {
  const elsewhere = Array.from({ length: PER_PAGE * MAX_PAGES + 1 }, (_, index) =>
    runEntry(1000 + index, { head_sha: OTHER_COMMIT }),
  );
  const { decision, calls } = await decided(elsewhere, {});
  expect(decision).toEqual({
    skip: false,
    message: `run, the lookup did not give an answer (the list of runs: more than ${MAX_PAGES} pages, so the search stopped)`,
  });
  expect(calls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '2', '3']);
});

test(`more than ${MAX_PAGES} full pages of jobs is a cap too`, async () => {
  const { decision, calls } = await decided([runEntry(700)], { 700: filler(PER_PAGE * MAX_PAGES) });
  expect(decision).toEqual({
    skip: false,
    message: `run, the lookup did not give an answer (the jobs of run 700: more than ${MAX_PAGES} pages, so the search stopped)`,
  });
  expect(calls).toHaveLength(1 + MAX_PAGES);
});

test(`${MAX_RUNS} runs without a pass are the cap on runs: the next one is not read, even if it passed`, async () => {
  const ids = Array.from({ length: MAX_RUNS + 1 }, (_, index) => 700 - index);
  const jobs = Object.fromEntries(
    ids.map((id, index) => [id, [jobEntry(NAME, index === MAX_RUNS ? 'success' : 'failure')]]),
  );
  const { decision, calls } = await decided(
    ids.map((id) => runEntry(id)),
    jobs,
  );
  expect(decision).toEqual({
    skip: false,
    message: `run, the lookup did not give an answer (${MAX_RUNS} earlier runs were read without finding a pass, so the search stopped)`,
  });
  expect(calls).toHaveLength(1 + MAX_RUNS);
});

test(`exactly ${MAX_RUNS} runs without a pass, the current run not counted among them, is an ordinary "no pass", not the cap`, async () => {
  const ids = Array.from({ length: MAX_RUNS }, (_, index) => 700 - index);
  const jobs = Object.fromEntries(ids.map((id) => [id, [jobEntry(NAME, 'failure')]]));
  const runs = [runEntry(CURRENT_RUN), ...ids.map((id) => runEntry(id))];
  const { decision, calls } = await decided(runs, jobs);
  expect(decision).toEqual({ skip: false, message: NO_PASS });
  expect(calls).toHaveLength(1 + MAX_RUNS);
});

test('the whole lookup shares one abort signal, so a slow API cannot hold the job past its limit', async () => {
  const { calls } = await decided([runEntry(700), runEntry(600)], { 700: [jobEntry(NAME, 'failure')], 600: PASSED });
  const signals = new Set(calls.map((call) => call.init.signal));
  expect(signals.size).toBe(1);
  const [signal] = [...signals];
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
  expect(LOOKUP_TIMEOUT_MS).toBe(60_000);
});
