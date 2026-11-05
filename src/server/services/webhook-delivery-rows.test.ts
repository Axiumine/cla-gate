// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { deliveryIdSchema } from '../domain/delivery-id.ts';
import { at, insertDelivery, retentionWorld } from './retention/test-support.ts';
import { isProcessed } from './webhook-delivery-rows.ts';

// Whether a recorded delivery is finished (E06-S06), including the delivery the retention sweep deleted (E22-S04).

const PENDING = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const FINISHED = '0f1e2d3c-4b5a-4968-8776-655443322110';
const GONE = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

test('a pending delivery is not processed, a processed one is, and one that is gone is not', async () => {
  const { db } = await retentionWorld();
  await insertDelivery(db, PENDING, null);
  await insertDelivery(db, FINISHED, at(-1000));
  const answers = await db.transaction().execute(async (trx) => ({
    pending: await isProcessed(trx, deliveryIdSchema.parse(PENDING)),
    finished: await isProcessed(trx, deliveryIdSchema.parse(FINISHED)),
    gone: await isProcessed(trx, deliveryIdSchema.parse(GONE)),
  }));
  expect(answers).toEqual({ pending: false, finished: true, gone: false });
});
