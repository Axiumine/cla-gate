// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The settings of the optional network metadata: whether the sign request stores the IP address and the user agent on
// `signer_pii` at all (E13-S05, off unless the operator switches it on), and how long they are kept (E16-S05). The limit
// is a setting of the instance and is enforced whether or not recording is still switched on, so there is no way to turn
// it off, only to shorten it.

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

export const retentionFields = {
  NETWORK_METADATA_RETENTION_DAYS: retentionDaysField.default(DEFAULT_RETENTION_DAYS),
  RECORD_NETWORK_METADATA: recordNetworkMetadataField.default(false),
};
