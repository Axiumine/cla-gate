// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ApiError } from '../../api/index.ts';
import { isRule } from '../../documents/document-rules.ts';

// How the erasure tells its own answers (E18-S14). A rule is told by the status and the code of the error body together, never by anything
// the server wrote as text.

/**
 * Whether `error` says that the installation holds nothing of the person (`404`): no signature and no allowlist entry. It is also the uniform
 * answer for an installation the viewer may not open, so the sentence it gets says no more than "nothing here".
 */
export function isNothingHeld(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Whether `error` is `409 count_changed`: the number of rows the person confirmed is no longer the number the installation holds. */
export function isCountChanged(error: unknown): boolean {
  return isRule(error, 'count_changed');
}
