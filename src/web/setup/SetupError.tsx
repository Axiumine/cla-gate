// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SETUP_ERROR_CODES } from '../../shared/setup.ts';
import { ApiError, NetworkError } from '../api/index.ts';
import { ErrorState } from '../states/index.ts';
import { StartAgainLink } from './StartAgainLink.tsx';

// A failed setup request (E19-S07): the message and remedy of its code come from the catalog (`errors.<code>`, which the
// setup codes joined), and what the person can do about it is next to it.

/** The codes whose remedy is to begin the setup again from its first page. */
const START_AGAIN: ReadonlySet<string> = new Set([
  SETUP_ERROR_CODES.locked,
  SETUP_ERROR_CODES.codeInvalid,
  SETUP_ERROR_CODES.githubUnexpected,
]);

/** The first status of a server failure: asking again can help for these (GitHub unreachable is a 502), and for a 429 after the wait. */
const SERVER_FAILURE = 500;
const TOO_MANY_REQUESTS = 429;

/** Whether asking again can give another answer: a request that never arrived, a server failure, or a request held back for a while. */
function canRetry(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= SERVER_FAILURE || error.status === TOO_MANY_REQUESTS;
  }
  return error instanceof NetworkError;
}

export interface SetupErrorProps {
  readonly error: unknown;
  /** Repeats the request. The button appears only when this is given and the failure is one that asking again can change. */
  readonly retry?: () => unknown;
  /** The repeat is under way. */
  readonly retrying?: boolean;
}

/**
 * The error state of a setup request: its message from the catalog, the request id, "Try again" when asking again can help
 * (GitHub could not be reached, a network failure, a wait after too many requests) and a link back to the first step when
 * the remedy is to start again (a used or expired code, a setup session that ended, an answer from GitHub that cannot be read).
 */
export function SetupError({ error, retry, retrying = false }: SetupErrorProps) {
  const again = error instanceof ApiError && START_AGAIN.has(error.code);
  return (
    <ErrorState error={error} {...(retry !== undefined && canRetry(error) ? { refetch: retry, retrying } : {})}>
      {again ? <StartAgainLink /> : null}
    </ErrorState>
  );
}
