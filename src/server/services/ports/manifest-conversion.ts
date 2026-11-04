// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { z } from 'zod';
import type { convertResponseSchema } from '../../../shared/setup.ts';

// The setup's only door to GitHub's app-manifest conversion (E19-S11): the one call that trades the one-time `code` of the
// manifest flow for the credentials of the App it created. It is separate from the client port (`./github.ts`), which speaks
// as the App or an installation: here there is no App yet and the code itself is the only credential. What it returns is
// the App's secrets; nothing in this layer stores or logs them.

/** The credentials of the App GitHub created, exactly as the setup answers with them (the shared contract of E19-S06). */
export type ManifestCredentials = z.infer<typeof convertResponseSchema>;

/**
 * How a conversion ends without credentials: GitHub does not know the code (used, older than an hour, or never issued), it
 * could not be reached (network failure, timeout, a redirect, `5xx` or `429`), or it answered with something that is not
 * the conversion's answer (any other status, or a body that does not parse).
 */
export type ConversionFailureReason = 'code_invalid' | 'unreachable' | 'unexpected_response';

/** A conversion failed. The message is fixed text: no code, address, header or body of GitHub's reaches it. */
export class ManifestConversionFailure extends Error {
  override readonly name = 'ManifestConversionFailure';
  readonly reason: ConversionFailureReason;

  constructor(reason: ConversionFailureReason) {
    super(`The manifest conversion failed (${reason})`);
    this.reason = reason;
  }
}

export interface ManifestConversion {
  /**
   * Trades the one-time code for the credentials of the App.
   * @throws ManifestConversionFailure when GitHub refuses the code, cannot be reached or answers with something unexpected.
   */
  convert(code: string): Promise<ManifestCredentials>;
}
