// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// The two ways an erasure of a signer's personal data is refused by the service (E16-S04), kept apart from the service so the
// HTTP adapter can tell them from any other failure without importing the code that runs the erasure.

/** The person has no signature in the tenant, so there is nothing of theirs to erase there. */
export class SignerNotFoundError extends Error {
  override readonly name = 'SignerNotFoundError';

  constructor() {
    super('the person has no signature in this tenant');
  }
}

/** The tenant holds another number of rows of personal data for the person than the admin confirmed; nothing was changed. */
export class ErasureCountChangedError extends Error {
  override readonly name = 'ErasureCountChangedError';

  constructor() {
    super('the rows of personal data changed since the preview');
  }
}
