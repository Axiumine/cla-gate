// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignState } from '../../shared/sign-context.ts';

// Where a person stands on the version of a CLA in force (E13-S02), pure. The sign page, and later the sign request, ask
// this one function. It reads signatures and nothing else: no login, no e-mail, no clock. A signature covers its signer only
// at exactly the active major, whatever its minor: a minor version never asks for a new signature (E08-S04 holds the
// evaluation to the same rule). Time is a number of milliseconds since the epoch, because this layer has no `Date`: the caller
// converts the instants the database stores.

/** One signature of the viewer on the document, with the minor of the version they signed. */
export interface ViewerSignature {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  /** When it was signed, in milliseconds since the epoch. */
  readonly signedAtMs: number;
  /** When it was revoked, in milliseconds since the epoch, or `null`; a revoked signature covers nobody. */
  readonly revokedAtMs: number | null;
}

/** A signature that was revoked, with the instant it ended. */
type RevokedSignature = ViewerSignature & { readonly revokedAtMs: number };

/** The answer: the state, the signature behind it, and the revoked signature the notice about revocation needs. */
export interface SignStatus {
  readonly state: SignState;
  /** The not revoked signature that covers (`already_signed`) or is out of date (`resign_required`); `null` for `ready`. */
  readonly signature: ViewerSignature | null;
  /** The newest revoked signature, only for `ready`; `null` when the state is another one or none was ever revoked. */
  readonly revoked: RevokedSignature | null;
}

const isRevoked = (signature: ViewerSignature): signature is RevokedSignature => signature.revokedAtMs !== null;

const isLive = (signature: ViewerSignature): boolean => signature.revokedAtMs === null;

/** The first of `signatures` in the order of `compare`, or `null` for none. */
function first<T extends ViewerSignature>(signatures: readonly T[], compare: (a: T, b: T) => number): T | null {
  return signatures.toSorted(compare)[0] ?? null;
}

/** The lowest signature id first, which is the basis the evaluation names when several cover the same person. */
const byLowestId = (a: ViewerSignature, b: ViewerSignature): number => a.id - b.id;

/** The latest major first, the lowest id among equals. */
const byLatestMajor = (a: ViewerSignature, b: ViewerSignature): number => b.major - a.major || a.id - b.id;

/** The signature made last first: by the instant it was signed, then by id. */
const byNewest = (a: ViewerSignature, b: ViewerSignature): number => b.signedAtMs - a.signedAtMs || b.id - a.id;

/**
 * The state of the viewer for a document whose active version has the major `activeMajor`, from their signatures on that
 * document (any order, revoked ones included):
 *
 * - `already_signed` when a signature that is not revoked has exactly the active major, whatever its minor;
 * - `resign_required` when none does and one that is not revoked has a lower major (the one of the latest major is named);
 * - `ready` otherwise, which includes a person whose only signatures are revoked and one whose signature has a higher major
 *   than the active one (a rollback publishes a new version, so a higher major is no more valid than a lower one).
 *
 * Only `ready` carries a revoked signature: the newest one by the instant it was signed, for the notice that a revocation
 * applies to future pull requests only.
 */
export function signStatus(activeMajor: number, signatures: readonly ViewerSignature[]): SignStatus {
  const live = signatures.filter(isLive);
  const covering = first(
    live.filter((signature) => signature.major === activeMajor),
    byLowestId,
  );
  if (covering !== null) {
    return { state: 'already_signed', signature: covering, revoked: null };
  }
  const outdated = first(
    live.filter((signature) => signature.major < activeMajor),
    byLatestMajor,
  );
  if (outdated !== null) {
    return { state: 'resign_required', signature: outdated, revoked: null };
  }
  return { state: 'ready', signature: null, revoked: first(signatures.filter(isRevoked), byNewest) };
}
