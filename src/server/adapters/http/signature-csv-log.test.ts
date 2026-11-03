// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { logReleaseFailure } from './signature-csv-log.ts';

// What the signature export logs when its snapshot cannot be ended (E16-S03).

test('a snapshot that could not be ended is one warning with the error and the event name, and nothing else', () => {
  const seen: unknown[][] = [];
  const log = {
    warn: (...args: unknown[]) => {
      seen.push(args);
    },
  };
  const failure = new Error('connection reset');
  logReleaseFailure(log)(failure);
  expect(seen).toEqual([[{ err: failure }, 'signature_export_release_failed']]);
});
