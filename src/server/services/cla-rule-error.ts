// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaRule } from '../../shared/cla.ts';

/** A rule of the documents API that the request broke (see `CLA_RULE_STATUS` for the status each is answered with). */
export class ClaRuleError extends Error {
  override readonly name = 'ClaRuleError';
  readonly rule: ClaRule;

  constructor(rule: ClaRule) {
    super(rule);
    this.rule = rule;
  }
}
