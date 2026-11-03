// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as auth from './index.ts';

test('the barrel exports what the screens use to know who is logged in and to log in and out, and nothing else', () => {
  expect(new Set(Object.keys(auth))).toEqual(
    new Set([
      'Avatar',
      'LoginLink',
      'LogoutButton',
      'SessionEndedBanner',
      'UserMenu',
      'avatarUrlSchema',
      'buildReturnTo',
      'loginStartUrl',
      'useApiClient',
      'useSession',
    ]),
  );
});
