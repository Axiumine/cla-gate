// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UNLINKED_ROLES } from '../../../shared/pr-evaluation-codes.ts';
import type { Account, RawIdentity, Role } from './types.ts';

// E08-S02: what actor extraction hands to the rules that follow (classification, allowlist, signatures, overrides).

export type UnlinkedRole = (typeof UNLINKED_ROLES)[number];

/** A distinct account that must be covered, with every role it plays and the commits it appears in (sorted). */
export interface ExtractedActor {
  readonly account: Account;
  readonly roles: readonly Role[];
  readonly shas: readonly string[];
}

/**
 * An author or committer that GitHub could not link to an account. `raw` is the display-only identity as git recorded
 * it, kept for the renderer (E09) and never stored.
 */
export interface UnlinkedFinding {
  readonly sha: string;
  readonly role: UnlinkedRole;
  readonly raw: RawIdentity;
}

export interface ActorExtraction {
  readonly actors: readonly ExtractedActor[];
  readonly unlinked: readonly UnlinkedFinding[];
  readonly mergeCommitsSkipped: number;
}
