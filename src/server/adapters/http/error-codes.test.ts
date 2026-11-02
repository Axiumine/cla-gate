// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { STATUS_ERROR_CODES } from '../../../shared/error-codes.ts';
import { errorBody } from './errors.ts';

// E17-S07: the shared list of status codes says what the error handler really answers with, so the web app's messages are
// keyed on codes that exist.

test.each(Object.entries(STATUS_ERROR_CODES))('status %s: the error handler names it %s', (status, code) => {
  expect(errorBody(Number(status), 'req-1').error.code).toBe(code);
});
