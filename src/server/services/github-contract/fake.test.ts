// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { CHECK_CASES } from '../github-check-contract/test-support.ts';
import { COMMENT_CASES } from '../github-comment-contract/test-support.ts';
import { MEMBERS_PROBE_CASES } from '../github-members-probe-contract/test-support.ts';
import { OPEN_PULL_CASES } from '../github-open-pulls-contract/test-support.ts';
import { PUBLIC_MEMBER_CASES } from '../github-public-member-contract/test-support.ts';
import { PULL_CASES } from '../github-pull-contract/test-support.ts';
import { ORGANIZATION_ACCOUNT_CASES, USER_ACCOUNT_CASES } from '../github-user-account-contract/test-support.ts';
import { CONTRACT_CASES, fakeWorld } from './test-support.ts';

test.each([
  ...CONTRACT_CASES,
  ...PULL_CASES,
  ...COMMENT_CASES,
  ...OPEN_PULL_CASES,
  ...CHECK_CASES,
  ...MEMBERS_PROBE_CASES,
  ...USER_ACCOUNT_CASES,
  ...ORGANIZATION_ACCOUNT_CASES,
  ...PUBLIC_MEMBER_CASES,
])('FakeGitHub: %s', async (_name, run) => {
  await run(fakeWorld());
});
