// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from '../../adapters/db/pglite.ts';
import { JOB_TYPES } from '../../domain/job-envelope.ts';
import { FakeClock } from '../test-support.ts';
import { deadLetterRegistry } from './dead-letter-registry.ts';

// The dead-letter table (E07-S05): a row for every job type of the catalogue.

test('there is a row for every job type of the catalogue: a type that is added without one fails here', async () => {
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  const registry = deadLetterRegistry({ db, evaluation: undefined }, new FakeClock('2026-11-02T10:00:00Z'));
  expect(registry.types()).toEqual([...JOB_TYPES]);
});
