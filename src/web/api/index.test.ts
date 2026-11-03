// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as api from './index.ts';

test('the barrel exports what the auth layer and the screens import to talk to the API, and nothing else', () => {
  expect(new Set(Object.keys(api))).toEqual(
    new Set(['ApiError', 'ContractError', 'NetworkError', 'createApiClient', 'createQueryClient']),
  );
});
