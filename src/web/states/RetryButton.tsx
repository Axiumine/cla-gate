// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { waitSeconds } from './error-facts.ts';
import { useCountdown } from './use-countdown.ts';

export interface RetryButtonProps {
  readonly error: unknown;
  readonly refetch: () => unknown;
  /** The retry is under way: the button is busy and ignores clicks, and keeps focus. */
  readonly retrying: boolean;
}

/**
 * "Try again" (E17-S07). After a 429 it stays disabled for the seconds the server asked for, and a countdown says how many
 * are left; at zero it is enabled. The countdown is `aria-live="off"`: a screen reader reads it once, with the error, and not
 * every second.
 */
export function RetryButton({ error, refetch, retrying }: RetryButtonProps) {
  const t = useT();
  const remaining = useCountdown(waitSeconds(error), error);
  return (
    <>
      <Button
        variant="primary"
        disabled={remaining > 0}
        loading={retrying}
        onClick={() => {
          void refetch();
        }}
      >
        {t('states.retry')}
      </Button>
      {remaining > 0 ? (
        <p aria-live="off" className="text-sm">
          {t.plural('states.retryIn', remaining)}
        </p>
      ) : null}
    </>
  );
}
