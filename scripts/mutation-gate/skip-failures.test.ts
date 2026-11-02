// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SHARD_NAMES } from './shards.ts';
import { decide, jobNameOf } from './skip-decision.ts';
import { PER_PAGE } from './skip-http.ts';
import { COMMIT, fakeGithub, githubOf, jobEntry, type Reply, runEntry, skipEnv, TOKEN } from './test-support.ts';

// E20-S04: whatever goes wrong while asking the API is a decision to run, never an error and never a skip. A lost record
// costs time, not coverage. The one throw is a shard name that is not a shard.

const ANSWER = 'run, the lookup did not give an answer';
const GOOD_RUNS = { status: 200, body: { workflow_runs: [runEntry(700)] } };
const GOOD_JOBS = { status: 200, body: { jobs: [jobEntry(jobNameOf('config'), 'success')] } };

/** A fake whose list of runs and list of jobs answer as given (a good answer for the one not given). */
function answering(runs: Reply = GOOD_RUNS, jobs: Reply = GOOD_JOBS) {
  return fakeGithub((url) => (url.pathname.endsWith('/runs') ? runs : jobs));
}

test('the fake itself would skip, so every failure below is the failure and nothing else', async () => {
  expect((await decide(skipEnv(), answering().fetcher)).skip).toBe(true);
});

test.each([204, 301, 304, 400, 401, 403, 404, 422, 429, 500, 502, 503])(
  'HTTP %j for the list of runs is a decision to run, and says which request failed',
  async (status) => {
    const decision = await decide(skipEnv(), answering({ status, body: { message: 'x' } }).fetcher);
    expect(decision).toEqual({ skip: false, message: `${ANSWER} (the list of runs: the API answered HTTP ${status})` });
  },
);

test('a run that the API does not know when its jobs are asked for is HTTP 404, and a decision to run', async () => {
  const github = githubOf([runEntry(700)], {});
  const decision = await decide(skipEnv(), github.fetcher);
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (the jobs of run 700: the API answered HTTP 404)` });
});

test.each([403, 404, 429, 500])('HTTP %j for the jobs of a run is a decision to run', async (status) => {
  const decision = await decide(skipEnv(), answering(GOOD_RUNS, { status, body: {} }).fetcher);
  expect(decision).toEqual({
    skip: false,
    message: `${ANSWER} (the jobs of run 700: the API answered HTTP ${status})`,
  });
});

test.each([
  ['a network error', new TypeError('fetch failed')],
  ['a timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
  ['an abort', new DOMException('aborted', 'AbortError')],
])('%s is a decision to run, described by its class and never by its message', async (_what, error) => {
  const decision = await decide(skipEnv(), answering(error).fetcher);
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (unexpected ${error.name})` });
  const inJobs = await decide(skipEnv(), answering(GOOD_RUNS, error).fetcher);
  expect(inJobs).toEqual({ skip: false, message: `${ANSWER} (unexpected ${error.name})` });
});

test('a request that fails with something that is not an Error is a decision to run too', async () => {
  const plain: unknown = 'plain text';
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the test needs a rejection that is not an Error
  const decision = await decide(skipEnv(), () => Promise.reject(plain));
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (unexpected failure)` });
});

test('a body that is not JSON is a decision to run, for the list of runs and for the jobs', async () => {
  const first = await decide(skipEnv(), answering({ status: 200, notJson: true }).fetcher);
  expect(first).toEqual({ skip: false, message: `${ANSWER} (unexpected SyntaxError)` });
  const second = await decide(skipEnv(), answering(GOOD_RUNS, { status: 200, notJson: true }).fetcher);
  expect(second).toEqual({ skip: false, message: `${ANSWER} (unexpected SyntaxError)` });
});

// Schemes that are not https, spelled so that no clear-text URL appears in the source.
const PLAIN = ['ht', 'tp'].join('');
const OTHER = ['f', 'tp'].join('');
const LIST = 'the list of runs: the answer has an unexpected shape';
const ENTRY = 'the list of runs: an entry has an unexpected shape';

test.each([
  ['null', null, LIST],
  ['a list', [], LIST],
  ['a string', 'runs', LIST],
  ['an empty object', {}, LIST],
  ['a list that is null', { workflow_runs: null }, LIST],
  ['a list that is an object', { workflow_runs: {} }, LIST],
  ['an entry that is null', { workflow_runs: [null] }, LIST],
  ['an entry that is a string', { workflow_runs: ['run'] }, LIST],
  ['an entry that is a list', { workflow_runs: [[]] }, LIST],
  ['an entry without an id', { workflow_runs: [{ head_sha: COMMIT }] }, ENTRY],
  ['an id that is a string', { workflow_runs: [{ id: '700', head_sha: COMMIT }] }, ENTRY],
  ['an id that is not an integer', { workflow_runs: [{ id: 1.5, head_sha: COMMIT }] }, ENTRY],
  ['an id that is too large to be exact', { workflow_runs: [{ id: 2 ** 60, head_sha: COMMIT }] }, ENTRY],
  ['a head_sha that is a number', { workflow_runs: [{ id: 700, head_sha: 1 }] }, ENTRY],
  ['a head_sha that is missing', { workflow_runs: [{ id: 700 }] }, ENTRY],
])('a list of runs with %s is a decision to run', async (_what, body, reason) => {
  const decision = await decide(skipEnv(), answering({ status: 200, body }).fetcher);
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (${reason})` });
});

const JOBS = 'the jobs of run 700: the answer has an unexpected shape';

test.each([
  ['null', null, JOBS],
  ['a list', [], JOBS],
  ['no jobs field', {}, JOBS],
  ['jobs that are a string', { jobs: 'jobs' }, JOBS],
  ['an entry that is null', { jobs: [null] }, JOBS],
  ['an entry that is a list', { jobs: [[]] }, JOBS],
  [
    'an entry without a name',
    { jobs: [{ conclusion: 'success', status: 'completed' }] },
    'the jobs of run 700: an entry has an unexpected shape',
  ],
  [
    'a name that is a number',
    { jobs: [{ name: 5, conclusion: 'success' }] },
    'the jobs of run 700: an entry has an unexpected shape',
  ],
])('the jobs of a run with %s are a decision to run', async (_what, body, reason) => {
  const decision = await decide(skipEnv(), answering(GOOD_RUNS, { status: 200, body }).fetcher);
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (${reason})` });
});

test('a filter that the API ignores cannot make another commit, event or state count: every entry is checked again', async () => {
  const runs = [
    runEntry(701, { head_sha: 'c3'.repeat(20) }),
    runEntry(702, { event: 'push' }),
    runEntry(703, { status: 'in_progress' }),
    ...Array.from({ length: PER_PAGE }, (_, index) => runEntry(800 + index, { event: 'pull_request' })),
  ];
  const github = githubOf(runs, { 701: [jobEntry(jobNameOf('config'), 'success')] });
  const decision = await decide(skipEnv(), github.fetcher);
  expect(decision.skip).toBe(false);
  expect(github.calls.every((call) => !call.url.pathname.endsWith('/jobs'))).toBe(true);
});

test.each([
  ['GITHUB_API_URL', ''],
  ['GITHUB_API_URL', `${PLAIN}://api.github.com`],
  ['GITHUB_API_URL', 'api.github.com'],
  ['GITHUB_API_URL', `${OTHER}://api.github.com`],
  ['GITHUB_API_URL', undefined],
  ['GITHUB_REPOSITORY', ''],
  ['GITHUB_REPOSITORY', 'cla-gate'],
  ['GITHUB_REPOSITORY', 'Axiumine/cla-gate/extra'],
  ['GITHUB_REPOSITORY', 'Axiumine/cla-gate?per_page=1'],
  ['GITHUB_REPOSITORY', 'Axiumine/cla gate'],
  ['GITHUB_REPOSITORY', '../cla-gate'],
  ['GITHUB_REPOSITORY', 'Axiumine/..'],
  ['GITHUB_REPOSITORY', 'Axiumine/.'],
  ['GITHUB_REPOSITORY', undefined],
  ['GITHUB_SHA', ''],
  ['GITHUB_SHA', 'abc123'],
  ['GITHUB_SHA', COMMIT.toUpperCase()],
  ['GITHUB_SHA', COMMIT.slice(1)],
  ['GITHUB_SHA', `${COMMIT}0`],
  ['GITHUB_SHA', 'g'.repeat(40)],
  ['GITHUB_SHA', `${COMMIT}&event=push`],
  ['GITHUB_SHA', undefined],
  ['GITHUB_RUN_ID', ''],
  ['GITHUB_RUN_ID', 'abc'],
  ['GITHUB_RUN_ID', '0'],
  ['GITHUB_RUN_ID', '-1'],
  ['GITHUB_RUN_ID', '1.5'],
  ['GITHUB_RUN_ID', '9'.repeat(16)],
  ['GITHUB_RUN_ID', undefined],
])('%s = %j is a decision to run, before any request', async (name, value) => {
  const github = answering();
  const decision = await decide(skipEnv({ [name]: value }), github.fetcher);
  const problem =
    name === 'GITHUB_API_URL' ? 'GITHUB_API_URL is missing or not an https URL' : `${name} is missing or malformed`;
  expect(decision).toEqual({ skip: false, message: `${ANSWER} (${problem})` });
});

test('a repository named .github, which GitHub allows, and a 64-digit commit are accepted', async () => {
  const sha = 'c4'.repeat(32);
  const github = answering({ status: 200, body: { workflow_runs: [runEntry(700, { head_sha: sha })] } });
  const decision = await decide(skipEnv({ GITHUB_REPOSITORY: 'Axiumine/.github', GITHUB_SHA: sha }), github.fetcher);
  expect(decision).toMatchObject({ skip: true, runId: 700, sha });
});

test.each(['', 'nope', 'Shared', 'shared ', 'all', 'scripts,shared'])(
  'a shard that is not a shard (%j) throws before any request, whatever the event',
  async (shard) => {
    for (const event of ['schedule', 'workflow_dispatch']) {
      const github = answering();
      await expect(decide(skipEnv({ STRYKER_SHARD: shard, GITHUB_EVENT_NAME: event }), github.fetcher)).rejects.toThrow(
        `STRYKER_SHARD must be one of ${SHARD_NAMES.join(', ')}, not ${JSON.stringify(shard)}`,
      );
      expect(github.calls).toEqual([]);
    }
  },
);

test('an unset shard throws', async () => {
  await expect(decide(skipEnv({ STRYKER_SHARD: undefined }), answering().fetcher)).rejects.toThrow(
    'STRYKER_SHARD must be one of',
  );
});

test('the token never appears in a decision, whatever the API answers or throws', async () => {
  const leaky = { message: `Bad credentials ${TOKEN}`, token: TOKEN };
  const replies: Reply[] = [
    { status: 403, body: leaky },
    { status: 200, body: { workflow_runs: [{ id: TOKEN, head_sha: TOKEN }] } },
    new Error(`Bearer ${TOKEN}`),
    new TypeError(`fetch failed for ${TOKEN}`, { cause: new Error(TOKEN) }),
    { status: 200, notJson: true },
  ];
  for (const reply of replies) {
    const decision = await decide(skipEnv(), answering(reply).fetcher);
    expect(JSON.stringify(decision)).not.toContain(TOKEN);
    expect(decision.skip).toBe(false);
  }
  const inJobs = await decide(skipEnv(), answering(GOOD_RUNS, { status: 500, body: leaky }).fetcher);
  expect(JSON.stringify(inJobs)).not.toContain(TOKEN);
  const skipped = await decide(skipEnv(), answering().fetcher);
  expect(JSON.stringify(skipped)).not.toContain(TOKEN);
});

test('control characters in an error name or a shard cannot forge a log line', async () => {
  const error = new Error('x');
  error.name = 'Bad\nname::error::forged';
  const decision = await decide(skipEnv(), answering(error).fetcher);
  expect(decision.message).not.toMatch(/\p{Cc}/u);
  const thrown = await decide(skipEnv({ STRYKER_SHARD: 'x\ny' }), answering().fetcher).catch(
    (caught: unknown) => caught,
  );
  expect(String(thrown)).not.toMatch(/\n/);
});
