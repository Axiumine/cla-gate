// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import {
  COMMIT_LOOKUP_TIMEOUT_MS,
  type CommitGitHub,
  commitGitHubNotWired,
  requireCommit,
} from './commit-override-lookup.ts';
import { commitSha } from './github-pull-contract/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from './ports/github-errors.ts';

// Whether the repository has the commit an override is for (E15-S05): what each answer and each failure of the GitHub client port is
// told as, and the 5 seconds a person waits for it. Fake timers, so the boundary is exact and nothing sleeps.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const COMMIT = { githubInstallationId: parseGithubId(5000), fullName: 'org-1/repo', sha: commitSha(7) };

/** A GitHub whose lookup does what `getCommit` says, and the arguments it was called with. */
function githubThat(getCommit: CommitGitHub['getCommit']) {
  const calls: unknown[][] = [];
  const github: CommitGitHub = {
    getCommit: (...args) => {
      calls.push(args);
      return getCommit(...args);
    },
  };
  return { github, calls };
}

/** What `requireCommit` settled as, without failing the test on a rejection. */
const outcomeOf = (work: Promise<void>): Promise<unknown> =>
  work.then(
    () => 'found',
    (failure: unknown) => failure,
  );

test('the lookup asks for the commit of the repository under the installation, with nothing else', async () => {
  const { github, calls } = githubThat(() => Promise.resolve({ sha: COMMIT.sha }));
  await expect(requireCommit(github, COMMIT)).resolves.toBeUndefined();
  expect(calls).toEqual([[COMMIT.githubInstallationId, 'org-1/repo', COMMIT.sha]]);
});

test('a commit GitHub does not show (null) is commit_not_found', async () => {
  const { github } = githubThat(() => Promise.resolve(null));
  const failure = await outcomeOf(requireCommit(github, COMMIT));
  expect(failure).toBeInstanceOf(ClaRuleError);
  expect(failure).toMatchObject({ rule: 'commit_not_found' });
});

test.each([
  ['a 404', new GitHubNotFoundError('GET /repos/zzzz/commits/zzzz')],
  ['a 422', new GitHubUnprocessableError('GET /repos/zzzz/commits/zzzz')],
])('GitHub answering %s is commit_not_found, with nothing of the answer', async (_name, error) => {
  const { github } = githubThat(() => Promise.reject(error));
  const failure = await outcomeOf(requireCommit(github, COMMIT));
  expect(failure).toBeInstanceOf(ClaRuleError);
  expect(failure).toMatchObject({ rule: 'commit_not_found', message: 'commit_not_found' });
});

test('a rate limit and an outage are told as they are, so the route answers them with the wait and with 502', async () => {
  const limited = new GitHubRateLimitedError(120, 'secondary');
  const down = new GitHubUnavailableError('GitHub answered 500');
  const first = githubThat(() => Promise.reject(limited));
  const second = githubThat(() => Promise.reject(down));
  expect(await outcomeOf(requireCommit(first.github, COMMIT))).toBe(limited);
  expect(await outcomeOf(requireCommit(second.github, COMMIT))).toBe(down);
});

test.each([
  ['a refusal of the token', new GitHubForbiddenError('GET /repos/zzzz/commits/zzzz')],
  ['an answer that is not a commit', new GitHubResponseError('GET /repos/{owner}/{repo}/commits/{ref}', ['zzzz'])],
  ['an unexpected error', new TypeError('zzzz-secret')],
])(
  '%s is an outage with fixed text: nothing GitHub sent, and nothing of the request, is carried on',
  async (_name, error) => {
    const { github } = githubThat(() => Promise.reject(error));
    const failure = await outcomeOf(requireCommit(github, COMMIT));
    expect(failure).toBeInstanceOf(GitHubUnavailableError);
    expect(String(failure)).toBe('GitHubUnavailableError: GitHub could not answer the lookup of the commit');
  },
);

test('a lookup that throws before it returns a promise is an outage too', async () => {
  const { github } = githubThat(() => {
    throw new Error('zzzz-secret');
  });
  const failure = await outcomeOf(requireCommit(github, COMMIT));
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
});

test('the deadline is 5 seconds', () => {
  expect(COMMIT_LOOKUP_TIMEOUT_MS).toBe(5000);
});

test('a lookup that has not answered at 4.999 s is still waited for, and fails as an outage at 5 s, the retries of the port included', async () => {
  const { github } = githubThat(() => new Promise<never>(() => undefined));
  let outcome: unknown = 'pending';
  void outcomeOf(requireCommit(github, COMMIT)).then((settled) => {
    outcome = settled;
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toBeInstanceOf(GitHubUnavailableError);
  expect(String(outcome)).toBe('GitHubUnavailableError: GitHub did not answer a commit lookup within 5000 ms');
  expect(vi.getTimerCount()).toBe(0);
});

test('an answer in time leaves no timer behind, and one after the deadline changes nothing', async () => {
  const slow = Promise.withResolvers<{ sha: string }>();
  const { github } = githubThat(() => slow.promise);
  const outcome = outcomeOf(requireCommit(github, COMMIT));
  await vi.advanceTimersByTimeAsync(COMMIT_LOOKUP_TIMEOUT_MS);
  expect(await outcome).toBeInstanceOf(GitHubUnavailableError);
  slow.resolve({ sha: COMMIT.sha });
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a server with no GitHub App cannot look a commit up: every call is an outage', async () => {
  const failure = await outcomeOf(requireCommit(commitGitHubNotWired, COMMIT));
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(String(failure)).toBe('GitHubUnavailableError: no GitHub App is configured: commits cannot be looked up');
});
