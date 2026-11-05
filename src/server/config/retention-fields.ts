// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import {
  DEFAULT_RETENTION_BATCH_SIZE,
  DEFAULT_WEBHOOK_DELIVERIES_DAYS,
  MAX_RETENTION_BATCH_SIZE,
  MAX_WEBHOOK_DELIVERIES_DAYS,
  MIN_WEBHOOK_DELIVERIES_DAYS,
} from '../domain/retention.ts';

// The settings of the optional network metadata: whether the sign request stores the IP address and the user agent on
// `signer_pii` at all (E13-S05, off unless the operator switches it on), and how long they are kept (E16-S05). The limit
// is a setting of the instance and is enforced whether or not recording is still switched on, so there is no way to turn
// it off, only to shorten it. The two settings of the retention sweep of the operational rows (E22-S04) are here too.

/** A month: long enough to look into an abuse report, short enough that the values are not a profile of anyone. */
const DEFAULT_RETENTION_DAYS = 30;
/** The longest retention an instance may choose: a quarter. */
const MAX_RETENTION_DAYS = 90;

/** Whole days, digits only (no sign, fraction or exponent), from 1 to 90. */
const retentionDaysField = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .pipe(z.number().min(1).max(MAX_RETENTION_DAYS));

/**
 * `RECORD_NETWORK_METADATA` (E13-S05): exactly `true` or `false`, in lower case. Anything else (`TRUE`, `1`, `yes`, a padded
 * value) is refused by name instead of being read as one of the two, because a typo must never switch the recording of
 * personal data on, and a switch someone believes is on must not silently be off.
 */
const recordNetworkMetadataField = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * `RETENTION_WEBHOOK_DELIVERIES_DAYS` (E22-S04): whole days, digits only, from 7 to 3650. Below 7 is refused: GitHub redelivers
 * a delivery for 3 days, and a row purged inside that window would let a redelivery run twice.
 */
const webhookDeliveriesDaysField = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number)
  .pipe(z.number().min(MIN_WEBHOOK_DELIVERIES_DAYS).max(MAX_WEBHOOK_DELIVERIES_DAYS));

/** `RETENTION_BATCH_SIZE` (E22-S04): rows per batch, digits only, from 1 to 100000 and no leading zero. */
const batchSizeField = z
  .string()
  .regex(/^[1-9]\d{0,5}$/)
  .transform(Number)
  .pipe(z.number().max(MAX_RETENTION_BATCH_SIZE));

export const retentionFields = {
  NETWORK_METADATA_RETENTION_DAYS: retentionDaysField.default(DEFAULT_RETENTION_DAYS),
  RECORD_NETWORK_METADATA: recordNetworkMetadataField.default(false),
  RETENTION_WEBHOOK_DELIVERIES_DAYS: webhookDeliveriesDaysField.default(DEFAULT_WEBHOOK_DELIVERIES_DAYS),
  RETENTION_BATCH_SIZE: batchSizeField.default(DEFAULT_RETENTION_BATCH_SIZE),
};
