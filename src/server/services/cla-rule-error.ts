// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { ClaRule } from '../../shared/cla.ts';
import type { errorDetailsSchema } from '../../shared/errors.ts';

/** A rule of the documents API that the request broke (see `CLA_RULE_STATUS` for the status each is answered with). */
export class ClaRuleError extends Error {
  override readonly name = 'ClaRuleError';
  readonly rule: ClaRule;
  /** What the client is told besides the code (the size limit and the size of a text, E12-S02); never the content of a request. */
  readonly details: z.infer<typeof errorDetailsSchema> | undefined;

  constructor(rule: ClaRule, details?: z.infer<typeof errorDetailsSchema>) {
    super(rule);
    this.rule = rule;
    this.details = details;
  }
}
