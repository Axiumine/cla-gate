// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { COMMENT_CASES } from '../../services/github-comment-contract/test-support.ts';
import { CONTRACT_CASES } from '../../services/github-contract/test-support.ts';
import { PULL_CASES } from '../../services/github-pull-contract/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';

const signer = testGitHubKey();

test.each([...CONTRACT_CASES, ...PULL_CASES, ...COMMENT_CASES])('Octokit adapter: %s', async (_name, run) => {
  await run(await httpWorld(signer));
});
