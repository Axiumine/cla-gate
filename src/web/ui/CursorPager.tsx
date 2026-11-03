// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from './Button.tsx';
import { StatusMessage } from './StatusMessage.tsx';
import { useCursorTrail, useSettled } from './use-cursor-trail.ts';
import { type PagerDirection, useKeepFocus } from './use-keep-focus.ts';

export interface CursorPagerProps {
  /** The cursor of the page on screen, as the screen holds it (the address, usually): absent for the first page. Opaque. */
  readonly cursor: string | undefined;
  /** `nextCursor` of the response on screen: `null` on the last page. Opaque. */
  readonly nextCursor: string | null;
  /** Asks the screen to show the page with this cursor (`undefined` is the first page). The screen fetches it. */
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** A page is loading: both buttons are disabled, so one request is in flight at a time. */
  readonly loading?: boolean;
  /** The page that was asked for could not be loaded (a stale or tampered cursor): the pager says so and the page on screen stays. */
  readonly failed?: boolean;
}

interface PagerButtonProps {
  readonly direction: PagerDirection;
  readonly loading: boolean;
  /** Moves to the page; absent where there is no such page. */
  readonly go: (() => void) | undefined;
  /** Told which button was pressed, before `go` runs. */
  readonly onUse: (direction: PagerDirection) => void;
}

/** Previous or Next: switched off while a page loads and where there is no such page. */
function PagerButton({ direction, loading, go, onUse }: PagerButtonProps) {
  const t = useT();
  return (
    <Button
      data-direction={direction}
      disabled={loading || go === undefined}
      onClick={
        go === undefined
          ? undefined
          : () => {
              onUse(direction);
              go();
            }
      }
    >
      {t(`pager.${direction}`)}
    </Button>
  );
}

/**
 * Previous and Next over the opaque cursors of the server (E17-S10). Next hands back the `nextCursor` of the response;
 * Previous goes back through the pages the pager has been through (the server sends no cursor for the page before). The
 * page number is announced through a polite live region once the page has loaded, and not before, so it never names a
 * page that did not arrive. The screen keeps the page on screen until the next one is there (TanStack Query's
 * `placeholderData: keepPreviousData`) and keeps the last good page when a request fails; the pager adds the message,
 * and Previous and Next keep working from the page that is on screen. `loading` has to be true in the same render in which
 * `cursor` changes, which is what a query keyed by the cursor gives.
 */
export function CursorPager({ cursor, nextCursor, onCursorChange, loading = false, failed = false }: CursorPagerProps) {
  const t = useT();
  const { container, use } = useKeepFocus(loading);
  // The page on screen is the last one that loaded: a page that is loading, or that failed, is not the one Previous leaves.
  const shown = useSettled(cursor, !loading && !failed);
  const { page, back, forward } = useCursorTrail({ cursor: shown, nextCursor, onCursorChange });
  const label = page === undefined ? t('pager.later') : t('pager.page', { page });
  return (
    <nav ref={container} aria-label={t('pager.label')} className="flex flex-wrap items-center gap-3">
      <PagerButton direction="previous" loading={loading} go={back} onUse={use} />
      <StatusMessage>{label}</StatusMessage>
      <PagerButton direction="next" loading={loading} go={forward} onUse={use} />
      {failed ? (
        <p role="alert" className="w-full text-danger-fg">
          {t('pager.failed')}
        </p>
      ) : null}
    </nav>
  );
}
