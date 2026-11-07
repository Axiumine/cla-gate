// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { CorporateRule } from '../../shared/corporate.ts';
import type { errorDetailsSchema } from '../../shared/errors.ts';

/** A rule of corporate signing that the request broke (see `CORPORATE_RULE_STATUS` for the status each is answered with). */
export class CorporateRuleError extends Error {
  override readonly name = 'CorporateRuleError';
  readonly rule: CorporateRule;
  /** What the client is told besides the code (the version in force, for a stale one); never the content of a request. */
  readonly details: z.infer<typeof errorDetailsSchema> | undefined;
  /** How long GitHub asked to wait, in seconds, for `upstream_unavailable` when it was a rate limit (E21-S03); the client is told in `retry-after`. */
  readonly retryAfterSeconds: number | undefined;

  constructor(rule: CorporateRule, details?: z.infer<typeof errorDetailsSchema>, retryAfterSeconds?: number) {
    super(rule);
    this.rule = rule;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
