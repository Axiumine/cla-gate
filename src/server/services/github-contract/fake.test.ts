// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { CONTRACT_CASES, fakeWorld } from './test-support.ts';

test.each(CONTRACT_CASES)('FakeGitHub: %s', async (_name, run) => {
  await run(fakeWorld());
});
