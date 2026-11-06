// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning';

// E18-S12: a region with no text yet is in the page (a screen reader needs it there before its text changes) but draws nothing: the
// `empty:` classes take the colour, the border and the padding away, which the browser pass found as a coloured bar above a table.
const FILLED = 'border border-transparent px-3 py-2 rounded-md empty:border-0 empty:bg-transparent empty:p-0';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'text-fg',
  info: `${FILLED} bg-info-bg text-info-fg`,
  success: `${FILLED} bg-success-bg text-success-fg`,
  warning: `${FILLED} bg-warning-bg text-warning-fg`,
};

export interface StatusMessageProps {
  /** The change to announce: a result, a count, a page number. */
  readonly children?: ReactNode;
  readonly tone?: StatusTone;
  /** Announced and not shown: for a change the screen already shows another way (a new page of a table). */
  readonly visuallyHidden?: boolean;
}

/**
 * A polite live region (E17-S06): a screen reader reads a change to its text when it is next idle, without moving focus.
 * The region is in the page before its text changes, which is what makes the announcement work, so a primitive keeps one
 * mounted and changes the text. Errors that need attention are `role="alert"` (see `Field`), not this.
 */
export function StatusMessage({ children, tone = 'neutral', visuallyHidden = false }: StatusMessageProps) {
  // eslint-disable-next-line security/detect-object-injection -- tone is the closed StatusTone union, never user input
  const look = visuallyHidden ? 'sr-only' : TONE_CLASSES[tone];
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={look}>
      {children}
    </div>
  );
}
