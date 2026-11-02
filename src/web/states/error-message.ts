// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ErrorCode, isErrorCode } from '../../shared/error-codes.ts';
import { ApiError, ContractError, NetworkError } from '../api/errors.ts';
import type { Messages } from '../i18n/messages.ts';
import type { Translate } from '../i18n/translate.ts';

/** The catalog key of every code the app knows, and of the fallback: a code with no `errors.<code>` message fails `tsc`. */
type ErrorMessageKey = `errors.${ErrorCode | 'unknown'}`;

function keyOf(error: unknown): ErrorMessageKey {
  if (error instanceof ApiError) {
    return isErrorCode(error.code) ? `errors.${error.code}` : 'errors.unknown';
  }
  if (error instanceof NetworkError) {
    return 'errors.network';
  }
  return error instanceof ContractError ? 'errors.contract' : 'errors.unknown';
}

/**
 * The words for `error` (E17-S07), from the catalog and nowhere else: an {@link ApiError} is looked up by its `code`
 * (`errors.<code>`), a network failure and a contract failure by their own entries, and anything else, or a code the app has
 * no message for, gets `errors.unknown`. The wording of the server and the message of the error are never displayed: the
 * first can say more than a person should read, and the second can hold what the server sent.
 */
export function errorMessage(error: unknown, t: Translate<Messages>): string {
  return t(keyOf(error));
}
