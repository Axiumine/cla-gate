// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import assert from 'node:assert/strict';
import type { WebhookDelivery } from '../webhook-schemas.ts';

// The payloads of the webhook tests (E06-S03): GitHub's documented examples, trimmed to the parts that matter and
// rewritten with fictitious ids and names. Nothing in them is a real user, repository, email address or token. They keep
// fields the schemas do not declare (titles, URLs, logins, a repository name) so a test can see that those are stripped.

export type WebhookEvent = WebhookDelivery['event'];

/** The fictitious ids of the fixtures, so a test can name the id it expects to read back. */
export const FIXTURE_IDS = {
  installation: 31_001,
  repository: 52_002,
  author: 7_003,
  comment: 90_004,
  checkRun: 61_005,
  checkSuite: 61_006,
  app: 4242,
  account: 8_007,
  sender: 7_008,
} as const;

/** A commit id, 40 lower-case hexadecimal digits, as GitHub writes one. */
export const FIXTURE_SHA = '3f9a1c0b7d2e4a65b8c1d0e9f7a6b5c4d3e2f1a0';

/** The base branch tip the fixtures' merge group is built on. */
export const FIXTURE_BASE_SHA = 'c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe';

/** The head SHA of the merge group of the fixtures: the commit the `license/cla` check is reported on (E22-S01). */
export const FIXTURE_GROUP_SHA = '9b8a7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d';

const repository = {
  id: FIXTURE_IDS.repository,
  name: 'fixture-repo',
  full_name: 'fixture-org/fixture-repo',
  private: false,
  owner: { login: 'fixture-org', id: FIXTURE_IDS.account, type: 'Organization' },
};

const installation = { id: FIXTURE_IDS.installation, node_id: 'FIXTURE_INSTALLATION_NODE' };

const sender = { login: 'fixture-user', id: FIXTURE_IDS.sender, type: 'User' };

const account = { login: 'fixture-org', id: FIXTURE_IDS.account, type: 'Organization', site_admin: false };

const FIXTURES: Readonly<Record<WebhookEvent, Record<string, unknown>>> = {
  pull_request: {
    action: 'opened',
    number: 7,
    pull_request: {
      url: 'https://api.github.com/repos/fixture-org/fixture-repo/pulls/7',
      id: 1_700_000_007,
      number: 7,
      state: 'open',
      title: 'Fixture: add a topic',
      user: { login: 'fixture-contributor', id: FIXTURE_IDS.author, type: 'User' },
      body: 'A fixture description.',
      head: { label: 'fixture-contributor:topic', ref: 'topic', sha: FIXTURE_SHA },
      base: { label: 'fixture-org:main', ref: 'main', sha: 'c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe' },
      draft: false,
    },
    repository,
    sender,
    installation,
  },
  check_run: {
    action: 'rerequested',
    check_run: {
      id: FIXTURE_IDS.checkRun,
      name: 'license/cla',
      head_sha: FIXTURE_SHA,
      status: 'completed',
      conclusion: 'failure',
      app: { id: FIXTURE_IDS.app, slug: 'fixture-app', name: 'Fixture App' },
      pull_requests: [],
    },
    repository,
    sender,
    installation,
  },
  check_suite: {
    action: 'rerequested',
    check_suite: {
      id: FIXTURE_IDS.checkSuite,
      head_branch: 'topic',
      head_sha: FIXTURE_SHA,
      status: 'completed',
      app: { id: FIXTURE_IDS.app, slug: 'fixture-app', name: 'Fixture App' },
      pull_requests: [],
    },
    repository,
    sender,
    installation,
  },
  issue_comment: {
    action: 'created',
    issue: {
      number: 7,
      title: 'Fixture: add a topic',
      user: { login: 'fixture-contributor', id: FIXTURE_IDS.author, type: 'User' },
      pull_request: { url: 'https://api.github.com/repos/fixture-org/fixture-repo/pulls/7' },
    },
    comment: { id: FIXTURE_IDS.comment, body: 'Please /recheck this one.', user: sender },
    sender,
    repository,
    installation,
  },
  merge_group: {
    action: 'checks_requested',
    merge_group: {
      head_sha: FIXTURE_GROUP_SHA,
      head_ref: `refs/heads/gh-readonly-queue/main/pr-7-${FIXTURE_GROUP_SHA}`,
      base_ref: 'refs/heads/main',
      base_sha: FIXTURE_BASE_SHA,
      head_commit: {
        id: FIXTURE_GROUP_SHA,
        tree_id: '5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d',
        message: 'Fixture: add a topic (#7)',
        timestamp: '2026-01-02T03:04:05Z',
        author: { name: 'Fixture Contributor' },
        committer: { name: 'Fixture Committer' },
      },
    },
    repository,
    sender,
    installation,
  },
  installation: {
    action: 'created',
    installation: {
      id: FIXTURE_IDS.installation,
      account,
      repository_selection: 'selected',
      app_id: FIXTURE_IDS.app,
      permissions: { checks: 'write', pull_requests: 'write' },
    },
    repositories: [{ id: FIXTURE_IDS.repository, name: 'fixture-repo', full_name: 'fixture-org/fixture-repo' }],
    sender,
  },
  installation_repositories: {
    action: 'added',
    installation: { id: FIXTURE_IDS.installation, account, repository_selection: 'selected' },
    repository_selection: 'selected',
    repositories_added: [{ id: FIXTURE_IDS.repository, name: 'fixture-repo', full_name: 'fixture-org/fixture-repo' }],
    repositories_removed: [],
    sender,
  },
  github_app_authorization: {
    action: 'revoked',
    sender,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The member `key` of `node`, or `undefined` when `node` is not an object. */
function member(node: unknown, key: string): unknown {
  return isRecord(node) ? Reflect.get(node, key) : undefined;
}

/** A fresh copy of the fixture of `event`, which a test may change. */
export function webhookFixture(event: WebhookEvent): Record<string, unknown> {
  // eslint-disable-next-line security/detect-object-injection -- event is the closed WebhookEvent union, never user input
  return structuredClone(FIXTURES[event]);
}

/** The head SHA of the merge group of {@link mergeGroupOfSeveralFixture}: the commit of the last of its pull requests. */
export const FIXTURE_GROUP_OF_SEVERAL_SHA = '4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c';

/**
 * The `merge_group` `checks_requested` of a group that holds several pull requests (E22-S01), the second fixture of the story next
 * to the one of a group of one in {@link webhookFixture}: the payload has the same shape, and the name of its branch gives the last
 * pull request added (9). The ones before it (7 and 8) are in the commits between `base_sha` and `head_sha`, which no payload lists,
 * so the job finds them by asking GitHub which pull requests those commits belong to. Sanitised like every fixture: fictitious ids
 * and SHAs, no name or email.
 */
export function mergeGroupOfSeveralFixture(): Record<string, unknown> {
  const sha = FIXTURE_GROUP_OF_SEVERAL_SHA;
  const headCommit = {
    id: sha,
    tree_id: '6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e',
    message: 'Fixture: add yet another topic (#9)',
    timestamp: '2026-01-02T03:14:15Z',
    author: { name: 'Fixture Contributor' },
    committer: { name: 'Fixture Committer' },
  };
  const withSha = withValue(webhookFixture('merge_group'), 'merge_group.head_sha', sha);
  const withRef = withValue(withSha, 'merge_group.head_ref', `refs/heads/gh-readonly-queue/main/pr-9-${sha}`);
  return withValue(withRef, 'merge_group.head_commit', headCommit);
}

/** The names `Object.prototype` holds, in a fixed order: a payload that polluted it would add one. */
export function prototypeNames(): string[] {
  const names: string[] = [];
  for (let node = Reflect.getPrototypeOf({}); node !== null; node = Reflect.getPrototypeOf(node)) {
    names.push(...Reflect.ownKeys(node).map(String));
  }
  return sorted(names);
}

/** `names` in a fixed order, so two lists can be compared whatever order they were built in. */
export function sorted(names: readonly string[]): string[] {
  return names.toSorted((a, b) => a.localeCompare(b));
}

/** The value a path is set to in order to remove the key (an `undefined` would stay as a key). */
export const ABSENT = Symbol('absent');

/**
 * `payload` with the value at the dotted `path` (`pull_request.head.sha`) replaced by `value`, or the key removed when
 * `value` is {@link ABSENT}. The original is not changed.
 * @throws Error when the path does not lead to an object
 */
export function withValue(payload: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const copy = structuredClone(payload);
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce<unknown>(member, copy);
  assert.ok(isRecord(parent) && last !== undefined, `the fixture has no object at ${path}`);
  if (value === ABSENT) {
    Reflect.deleteProperty(parent, last);
  } else {
    Reflect.set(parent, last, value);
  }
  return copy;
}

const RAW_MARKER = '@@raw@@';

/**
 * The JSON text of `payload` with the number or text `raw` written as it is at `path`: for the values `JSON.stringify`
 * cannot write (`1e400`, an integer past 2**53) and for text a test wants byte for byte.
 */
export function withRawJson(payload: Record<string, unknown>, path: string, raw: string): string {
  return JSON.stringify(withValue(payload, path, RAW_MARKER)).replace(`"${RAW_MARKER}"`, () => raw);
}
