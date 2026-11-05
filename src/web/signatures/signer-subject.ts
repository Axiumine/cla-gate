// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Messages } from '../i18n/messages.ts';
import type { Translate } from '../i18n/translate.ts';
import type { Signature } from './signature-queries.ts';

/**
 * What a signature is called in a dialog and in the name of a button: the name the signer typed (text a person controls, so the
 * caller shows it through `UserText` or `visibleText`), or, once the personal data was erased, the numeric GitHub id.
 */
export function signerSubject(item: Signature, t: Translate<Messages>): string {
  return item.signer?.name ?? t('signatures.signer.erasedSubject', { id: item.githubUserId });
}
