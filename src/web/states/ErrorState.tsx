// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { Heading, type HeadingLevel } from '../ui/Heading.tsx';
import { isForbidden, visibleRequestId } from './error-facts.ts';
import { errorMessage } from './error-message.ts';
import { RequestId } from './RequestId.tsx';
import { RetryButton } from './RetryButton.tsx';

export interface ErrorStateProps {
  /** What went wrong: an `ApiError`, `NetworkError`, `ContractError` or anything else. Only its kind, code and request id are read. */
  readonly error: unknown;
  /** Runs the request again: a "Try again" button appears when it is given (never on a 403, which asking again does not change). */
  readonly refetch?: () => unknown;
  /** The request is being repeated: the "Try again" button is busy. */
  readonly retrying?: boolean;
  /** `page` replaces the content with a heading and the message; `banner` is the one line that sits above content that stays. */
  readonly variant?: 'page' | 'banner';
  /** The heading level of a `page` state. */
  readonly level?: HeadingLevel;
  /** Further actions after "Try again": "Reload", a link. */
  readonly children?: ReactNode;
}

/**
 * A failed request (E17-S07), as a `role="alert"`, so a screen reader announces it the moment it replaces the content. The
 * words are `errorMessage(error)`: never `error.message`, and never the server's wording. An `ApiError` shows its request id
 * with a copy button; a 403 is the forbidden state, with its own heading and no retry.
 */
export function ErrorState({
  error,
  refetch,
  retrying = false,
  variant = 'page',
  level = 2,
  children,
}: ErrorStateProps) {
  const t = useT();
  const forbidden = isForbidden(error);
  const requestId = visibleRequestId(error);
  const title = t(forbidden ? 'states.forbidden.title' : 'states.error.title');
  const layout =
    variant === 'page'
      ? 'flex flex-col items-start gap-3 rounded-lg border border-transparent bg-danger-bg p-6 text-danger-fg'
      : 'flex flex-col items-start gap-2 rounded-md border border-transparent bg-danger-bg px-3 py-2 text-danger-fg';
  return (
    <div role="alert" className={layout}>
      {variant === 'page' ? <Heading level={level}>{title}</Heading> : null}
      <p>{errorMessage(error, t)}</p>
      {requestId === undefined ? null : <RequestId id={requestId} />}
      <div className="flex flex-wrap items-center gap-2">
        {refetch === undefined || forbidden ? null : (
          <RetryButton error={error} refetch={refetch} retrying={retrying} />
        )}
        {children}
      </div>
    </div>
  );
}
