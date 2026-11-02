// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { COMMENT_CASES } from '../github-comment-contract/test-support.ts';
import { OPEN_PULL_CASES } from '../github-open-pulls-contract/test-support.ts';
import { PULL_CASES } from '../github-pull-contract/test-support.ts';
import { CONTRACT_CASES, fakeWorld } from './test-support.ts';

test.each([...CONTRACT_CASES, ...PULL_CASES, ...COMMENT_CASES, ...OPEN_PULL_CASES])(
  'FakeGitHub: %s',
  async (_name, run) => {
    await run(fakeWorld());
  },
);
