// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { within } from '@testing-library/react';
import { expect } from 'vitest';
import { messages } from '../i18n/index.ts';

/**
 * The reason field of a revocation or an invalidation: a required select with the empty "Choose" option and the four codes of
 * the API, each in the words of the catalog, in that order.
 */
export function expectRevokeReasonChoices(select: HTMLElement): void {
  expect(select).toHaveAttribute('aria-required', 'true');
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => [option.getAttribute('value'), option.textContent]),
  ).toEqual([
    ['', messages['signatures.revoke.reason.choose']],
    ['signer_request', messages['signatures.revoke.reason.signer_request']],
    ['maintainer_decision', messages['signatures.revoke.reason.maintainer_decision']],
    ['legal_request', messages['signatures.revoke.reason.legal_request']],
    ['other', messages['signatures.revoke.reason.other']],
  ]);
}
