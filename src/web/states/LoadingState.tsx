// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useAfter } from './use-after.ts';

/**
 * How long a request may take before a spinner appears. A response that comes sooner replaces the state with its data and
 * the page never flashes a spinner that is gone before it can be read.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SPINNER_DELAY_MS = 200;

/**
 * A request is under way (E17-S07). A polite live region says "Loading" to a screen reader at once, in text nobody else
 * sees, and the spinner joins after {@link SPINNER_DELAY_MS}. The spinner is decoration (`aria-hidden`), and a person who
 * asked for less motion gets a still ring (app.css).
 */
export function LoadingState() {
  const t = useT();
  const showSpinner = useAfter(SPINNER_DELAY_MS);
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-6">
      {showSpinner ? (
        <span
          aria-hidden="true"
          data-spinner=""
          className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
        />
      ) : null}
      <span className="sr-only">{t('states.loading')}</span>
    </div>
  );
}
