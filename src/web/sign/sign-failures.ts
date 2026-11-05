// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignRefusalRule } from '../../shared/sign.ts';
import { ApiError } from '../api/index.ts';

// Which failures of the sign page's two requests are a state of the page and not an error to report (E18-S02). Each question is
// asked of the status and of the code of the error body together, and never of the message or of anything the server sent.

const UNAUTHENTICATED = 401;
const CONFLICT = 409;

/** The refusals that say the text the person agreed to is not the text in force: nothing was recorded, read it again (E13-S04). */
const STALE_RULES: readonly string[] = ['stale_version', 'stale_consent'] satisfies readonly SignRefusalRule[];

/** Whether the server answered that there is no session: the page offers the login. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === UNAUTHENTICATED;
}

/** Whether the repository has no CLA in force (no document attached, or no published version): a neutral state, with no form. */
export function isNoActiveCla(error: unknown): boolean {
  return error instanceof ApiError && error.status === CONFLICT && error.code === 'no_active_cla';
}

/** Whether the sign request was refused because the version or the consent sentence on screen is no longer the one in force. */
export function isStaleRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status === CONFLICT && STALE_RULES.includes(error.code);
}
