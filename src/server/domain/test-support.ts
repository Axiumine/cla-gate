// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SUBSCRIBED_EVENTS } from './webhook-routing.ts';
import type { RoutingContext } from './webhook-routing-types.ts';

// The payloads of the routing tests (E06-S04), written for the domain, which imports nothing of the adapters. Every id
// field of a payload has its own value, so a job that read the wrong field names the wrong id and the test sees it.
// Every text that must never reach a job is the CANARY, so a copy of the payload into a job is found by a search.

export type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

/** `names` in a fixed order, so two lists can be compared whatever order they were built in. */
export function sorted(names: readonly string[]): string[] {
  return names.toSorted((a, b) => a.localeCompare(b));
}

/** The names `Object.prototype` holds, in a fixed order: a payload that polluted it would add one. */
export function prototypeNames(): string[] {
  const names: string[] = [];
  for (let node = Reflect.getPrototypeOf({}); node !== null; node = Reflect.getPrototypeOf(node)) {
    names.push(...Reflect.ownKeys(node).map(String));
  }
  return sorted(names);
}

/** The id of every field a job can read, and of the fields it must not read. */
export const IDS = {
  installation: 31_001,
  repository: 52_002,
  pullRequestNumber: 7,
  comment: 90_004,
  sender: 7_008,
  app: 4242,
  account: 8_007,
  repositoryOwner: 8_001,
  author: 7_003,
  pullRequestRecord: 1_700_000_007,
  checkRecord: 61_005,
} as const;

/** The text that stands for everything a job must not carry: a title, a login, an email address, a comment. */
export const CANARY = 'CANARY-must-not-reach-a-job';

export const DELIVERY_ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

export const SHA = '3f9a1c0b7d2e4a65b8c1d0e9f7a6b5c4d3e2f1a0';

/** The head SHA and the base SHA of the merge group of the payloads (E22-S01), and the number its branch name gives. */
export const GROUP_SHA = '9b8a7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d';
export const GROUP_BASE_SHA = 'c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe';
export const GROUP_TIP_NUMBER = 41;

/** The context of a delivery for this App. */
export const CONTEXT: RoutingContext = { appId: String(IDS.app), deliveryId: DELIVERY_ID };

const repository = {
  id: IDS.repository,
  name: CANARY,
  full_name: `${CANARY}/${CANARY}`,
  owner: { id: IDS.repositoryOwner },
};

const installation = { id: IDS.installation, node_id: CANARY };

const sender = { id: IDS.sender, login: CANARY, type: 'User', email: `${CANARY}@example.invalid` };

const account = { id: IDS.account, login: CANARY, type: 'Organization' };

const PAYLOADS: Readonly<Record<SubscribedEvent, Record<string, unknown>>> = {
  pull_request: {
    action: 'opened',
    number: IDS.pullRequestNumber,
    pull_request: {
      id: IDS.pullRequestRecord,
      number: IDS.pullRequestNumber,
      title: CANARY,
      body: CANARY,
      user: { id: IDS.author, login: CANARY, type: 'User' },
      head: { sha: SHA, ref: CANARY },
    },
    repository,
    sender,
    installation,
  },
  check_run: {
    action: 'rerequested',
    check_run: { id: IDS.checkRecord, name: 'license/cla', head_sha: SHA, app: { id: IDS.app, slug: CANARY } },
    repository,
    sender,
    installation,
  },
  check_suite: {
    action: 'rerequested',
    check_suite: { id: IDS.checkRecord, head_sha: SHA, head_branch: CANARY, app: { id: IDS.app, slug: CANARY } },
    repository,
    sender,
    installation,
  },
  issue_comment: {
    action: 'created',
    issue: { number: IDS.pullRequestNumber, title: CANARY, pull_request: { url: CANARY } },
    comment: { id: IDS.comment, body: `${CANARY} /recheck`, user: sender },
    sender,
    repository,
    installation,
  },
  merge_group: {
    action: 'checks_requested',
    merge_group: {
      head_sha: GROUP_SHA,
      head_ref: `refs/heads/gh-readonly-queue/main/pr-${GROUP_TIP_NUMBER}-${GROUP_SHA}`,
      base_sha: GROUP_BASE_SHA,
      head_commit: { id: GROUP_SHA, message: CANARY, author: { name: CANARY, email: `${CANARY}@example.invalid` } },
    },
    repository,
    sender,
    installation,
  },
  installation: {
    action: 'created',
    installation: { id: IDS.installation, account },
    repositories: [{ id: IDS.repository, name: CANARY }],
    sender,
  },
  installation_repositories: {
    action: 'added',
    installation: { id: IDS.installation, account },
    repositories_added: [{ id: IDS.repository, name: CANARY }],
    sender,
  },
  github_app_authorization: { action: 'revoked', sender },
};

/** A fresh copy of the payload of `event`, which a test may change. */
export function payloadOf(event: SubscribedEvent): Record<string, unknown> {
  // eslint-disable-next-line security/detect-object-injection -- event is the closed SubscribedEvent union, never user input
  return structuredClone(PAYLOADS[event]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The copy of `payload` a change is made on, with the object that holds the last key of the dotted `path` and that key. */
function editable(
  payload: Record<string, unknown>,
  path: string,
): { copy: Record<string, unknown>; holder: Record<string, unknown>; key: string } {
  const copy = structuredClone(payload);
  const dot = path.lastIndexOf('.');
  const key = path.slice(dot + 1);
  let node: unknown = copy;
  for (const step of dot < 0 ? [] : path.slice(0, dot).split('.')) {
    node = isRecord(node) ? Reflect.get(node, step) : undefined;
  }
  if (!isRecord(node)) {
    throw new Error(`the fixture has no object at ${path}`);
  }
  return { copy, holder: node, key };
}

/**
 * `payload` with the value at the dotted `path` (`check_run.app.id`) replaced by `value`. The original is not changed.
 * @throws Error when the path does not lead to an object
 */
export function withValue(payload: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const { copy, holder, key } = editable(payload, path);
  Reflect.set(holder, key, value);
  return copy;
}

/** `payload` with the key at the dotted `path` removed. */
export function without(payload: Record<string, unknown>, path: string): Record<string, unknown> {
  const { copy, holder, key } = editable(payload, path);
  Reflect.deleteProperty(holder, key);
  return copy;
}

/** The job each default payload becomes, for the tests that compare a whole job (plain numbers: a job's ids are branded, a test compares values). */
export const JOBS = {
  evaluatePr: {
    type: 'evaluate-pr',
    trigger: 'pull_request',
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
    deliveryId: DELIVERY_ID,
  },
  closePr: {
    type: 'close-pr',
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
    deliveryId: DELIVERY_ID,
  },
  evaluateHeadSha: {
    type: 'evaluate-head-sha',
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    headSha: SHA,
    deliveryId: DELIVERY_ID,
  },
  recheckComment: {
    type: 'recheck-comment',
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
    commentId: IDS.comment,
    deliveryId: DELIVERY_ID,
  },
  syncInstallation: {
    type: 'sync-installation',
    githubInstallationId: IDS.installation,
    deliveryId: DELIVERY_ID,
  },
  evaluateMergeGroup: {
    type: 'evaluate-merge-group',
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    headSha: GROUP_SHA,
    baseSha: GROUP_BASE_SHA,
    tipPrNumber: GROUP_TIP_NUMBER,
    deliveryId: DELIVERY_ID,
  },
  revokeUserSessions: { type: 'revoke-user-sessions', githubUserId: IDS.sender, deliveryId: DELIVERY_ID },
} as const;
