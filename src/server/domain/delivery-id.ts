// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The key a webhook delivery is recorded under (E06-S06). GitHub gives every delivery a UUID in `X-GitHub-Delivery` and
// reuses it when a delivery is redelivered, so it is the idempotency key. The brand makes the type say what the check
// says: a `DeliveryId` was parsed as a UUID and lower-cased, so the string that reaches `webhook_deliveries.delivery_id`
// is never the header as it came in.

/**
 * A UUID in any version, as GitHub writes it, stored lower-case so that one delivery never has two keys (36 characters,
 * inside the 1 to 128 the column allows).
 */
export const deliveryIdSchema = z
  .guid()
  .transform((id) => id.toLowerCase())
  .brand<'DeliveryId'>();

/** A parsed `X-GitHub-Delivery`. */
export type DeliveryId = z.infer<typeof deliveryIdSchema>;
