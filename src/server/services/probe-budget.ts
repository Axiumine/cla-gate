// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// A per-request counter of the GitHub calls a role discovery may make (E11-S03). The rule "is this person admin of any
// repository here" has to ask GitHub about repositories one at a time, so a request that triggers it carries a budget:
// a call that reaches GitHub spends one, a call the role cache answers spends none (E11-S04), and an empty budget ends
// the discovery with a truncated answer instead of an unbounded fan-out against the budget of one installation.

/** How many probes a request may spend, by what asks. */
export const PROBE_BUDGETS = {
  /** The installation list of E14-S01. */
  installationList: 100,
  /** The repository list and the override endpoints of E15. */
  repositoryList: 50,
  /**
   * The denial path of E11-S05, which only has to choose between 403 and 404: small, so that a stranger who hits endpoints
   * costs at most this many GitHub calls per installation per cache window.
   */
  denial: 10,
} as const;

/** A probe was asked for after the budget was used up. The discovery catches it and reports a truncated answer. */
export class ProbeBudgetExhaustedError extends Error {
  constructor() {
    super('the probe budget of this request is used up');
    this.name = 'ProbeBudgetExhaustedError';
  }
}

export class ProbeBudget {
  #remaining: number;

  /** @throws RangeError when `limit` is not a non-negative integer. */
  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError('a probe budget is a non-negative integer');
    }
    this.#remaining = limit;
  }

  /** The probes left. */
  get remaining(): number {
    return this.#remaining;
  }

  /** Spends one probe, right before a call reaches GitHub. @throws ProbeBudgetExhaustedError when none is left. */
  spend(): void {
    if (this.#remaining === 0) {
      throw new ProbeBudgetExhaustedError();
    }
    this.#remaining -= 1;
  }
}
