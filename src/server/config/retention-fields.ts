// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The retention of the optional network metadata (E16-S05): how long the IP address and the user agent that E13-S05 may
// store on `signer_pii` are kept. The limit is a setting of the instance and is enforced whether or not recording is
// still switched on, so there is no way to turn it off, only to shorten it.

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

export const retentionFields = {
  NETWORK_METADATA_RETENTION_DAYS: retentionDaysField.default(DEFAULT_RETENTION_DAYS),
};
