// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CHECK_NAME } from './check-name.ts';

test('the Check Run is named license/cla, the name branch protection rules and the docs refer to', () => {
  expect(CHECK_NAME).toBe('license/cla');
});
