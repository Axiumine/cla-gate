// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { CHECK_CASES } from '../../services/github-check-contract/test-support.ts';
import { COMMENT_CASES } from '../../services/github-comment-contract/test-support.ts';
import { CONTRACT_CASES } from '../../services/github-contract/test-support.ts';
import { MEMBERS_PROBE_CASES } from '../../services/github-members-probe-contract/test-support.ts';
import { OPEN_PULL_CASES } from '../../services/github-open-pulls-contract/test-support.ts';
import { PUBLIC_MEMBER_CASES } from '../../services/github-public-member-contract/test-support.ts';
import { PULL_CASES } from '../../services/github-pull-contract/test-support.ts';
import {
  ORGANIZATION_ACCOUNT_CASES,
  USER_ACCOUNT_CASES,
} from '../../services/github-user-account-contract/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';

const signer = testGitHubKey();

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
])('Octokit adapter: %s', async (_name, run) => {
  await run(await httpWorld(signer));
});
