// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * What a lookup is told by the cache that runs it. A lookup that does more than answer (E11-S07 writes the ledger of org
 * admins from what it finds) asks {@link LookupContext.isCurrent} right before it does, so that an older answer cannot undo
 * a newer one.
 */
export interface LookupContext {
  /**
   * Whether this lookup is still the current one of its key: false once a fresh lookup displaced it or an invalidation
   * dropped it. A lookup that is not current answers its own callers and the cache keeps nothing of it; whatever else it
   * would write must not outlive it either. Ask after the first `await` of the lookup, not before.
   */
  readonly isCurrent: () => boolean;
}
