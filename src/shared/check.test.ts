// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CHECK_RUN_NAME } from './check.ts';

// The scan that proves no other source file spells the name is src/server/check-name-literal.test.ts: it reads the file
// system, which a test under src/shared cannot (this folder is also compiled for the browser, which has no Node types).

test('the Check Run is named license/cla, the name branch protection rules and the docs refer to', () => {
  expect(CHECK_RUN_NAME).toBe('license/cla');
});
