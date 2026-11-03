// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as states from './index.ts';

test('the barrel exports the states, the boundaries and the router components, and nothing else', () => {
  expect(new Set(Object.keys(states))).toEqual(
    new Set([
      'EmptyState',
      'ErrorState',
      'LoadingState',
      'NotFoundPage',
      'QueryBoundary',
      'RootErrorBoundary',
      'RouterErrorComponent',
      'errorMessage',
    ]),
  );
});
