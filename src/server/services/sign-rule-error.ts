// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignerRule } from '../../shared/signer-input.ts';

/**
 * A rule of the signing request that it broke (E13-S03; see `SIGNER_RULE_STATUS` for the status each is answered with). The
 * message is the rule's code and nothing else: neither the typed name nor the requested address is ever kept in it.
 */
export class SignRuleError extends Error {
  override readonly name = 'SignRuleError';
  readonly rule: SignerRule;

  constructor(rule: SignerRule) {
    super(rule);
    this.rule = rule;
  }
}
