// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The judgement of the operator's erasure command (E22-S05), with no database in it; the wording is in
// operator-erasure-lines.ts. A GitHub id is global, so the command looks at a person across every installation of the server; what
// it holds about them is a footprint: the signature cores and the rows of personal data per installation, and whether the display
// snapshot in `users` is already scrubbed.

/** What one installation holds about the person. */
export interface InstallationFootprint {
  /** `installations.id`, the tenant key `erase_signer_pii` takes. */
  readonly installationId: number;
  /** The signature cores, revoked ones included: erasure keeps every one. */
  readonly signatures: number;
  /** The `signer_pii` rows: name, email and login, one per signature that has them. */
  readonly signerPiiRows: number;
}

/** What the server holds about a person, read from the tables of the runtime role. */
export interface Footprint {
  /** False for a GitHub id that has no `users` row: the server never saw this person. */
  readonly known: boolean;
  /** True when `users.login` is `erased-<github id>`, which is what the erasure function leaves. */
  readonly scrubbed: boolean;
  /** One entry per installation in which the person has signatures, in ascending order of `installationId`. */
  readonly installations: readonly InstallationFootprint[];
}

/** The rows `erase_signer_pii` deleted in one installation. */
export interface ErasedInstallation {
  readonly installationId: number;
  readonly deleted: number;
}

/** What a run came to. */
export type ErasureOutcome =
  /** No `users` row for this GitHub id. */
  | { readonly kind: 'unknown' }
  /** No `signer_pii` row in any installation and the snapshot scrubbed: nothing was called, nothing was written. */
  | { readonly kind: 'nothing' }
  /** A dry run: what an erasure would remove and keep. */
  | { readonly kind: 'dry_run'; readonly before: Footprint }
  /** The erasure ran and the check after it held. */
  | {
      readonly kind: 'erased';
      readonly before: Footprint;
      readonly erased: readonly ErasedInstallation[];
    }
  /** The erasure ran to the end and the check after it did not hold. */
  | { readonly kind: 'mismatch'; readonly before: Footprint; readonly after: Footprint }
  /** A call failed: the installations that finished and those still to do. `cause` is only ever named by type and code. */
  | {
      readonly kind: 'failed';
      readonly done: readonly number[];
      readonly pending: readonly number[];
      readonly cause: unknown;
    };

/** The `signer_pii` rows of the person in all installations. */
export const rowsOf = (footprint: Footprint): number =>
  footprint.installations.reduce((total, installation) => total + installation.signerPiiRows, 0);

/** The signature cores of the person in all installations. */
export const signaturesOf = (footprint: Footprint): number =>
  footprint.installations.reduce((total, installation) => total + installation.signatures, 0);

/** True for a person with no personal data left to erase: no `signer_pii` row anywhere and the snapshot already scrubbed. */
export const isErased = (footprint: Footprint): boolean => rowsOf(footprint) === 0 && footprint.scrubbed;

/** The installations that still hold rows of personal data of the person. */
export const withRows = (footprint: Footprint): readonly InstallationFootprint[] =>
  footprint.installations.filter((installation) => installation.signerPiiRows > 0);

/** True when both footprints have the same installations with the same signature counts: erasure is not revocation, so the cores must be untouched. */
export function sameSignatures(before: Footprint, after: Footprint): boolean {
  return (
    before.installations.length === after.installations.length &&
    before.installations.every((installation, index) => {
      const other = after.installations.at(index);
      return other?.installationId === installation.installationId && other.signatures === installation.signatures;
    })
  );
}

/**
 * The post-conditions of an erasure, checked once after the loop: no `signer_pii` row of the person in any installation, the
 * snapshot scrubbed, and the signature cores exactly as they were.
 */
export function erasureHolds(before: Footprint, after: Footprint): boolean {
  return withRows(after).length === 0 && after.scrubbed && sameSignatures(before, after);
}

/** The exit code of an outcome: 0 when it ran (or had nothing to do), 1 for an unknown person, 3 for a check that did not hold, 4 for a call that failed. */
export function exitCodeOf(outcome: ErasureOutcome): number {
  switch (outcome.kind) {
    case 'unknown':
      return 1;
    case 'mismatch':
      return 3;
    case 'failed':
      return 4;
    case 'nothing':
    case 'dry_run':
    case 'erased':
      return 0;
  }
}
