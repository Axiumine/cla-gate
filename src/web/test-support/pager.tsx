// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Ref, useImperativeHandle, useState } from 'react';
import { CursorPager } from '../ui/CursorPager.tsx';

// A screen for the tests of CursorPager (E17-S10): it holds the cursor, the way an address would, and goes into loading in
// the same render in which the cursor changes, which is what a query keyed by the cursor does. The page on screen (whose
// `nextCursor` the pager is given) is the last one that loaded. The test ends the load.

/** What the server says follows each page: three pages, c2 then c3, and no more. */
const NEXT = new Map<string | undefined, string | null>([
  [undefined, 'c2'],
  ['c2', 'c3'],
  ['c3', null],
]);

type LoadState = 'idle' | 'loading' | 'failed';

/** How a test starts a load, and ends the one that the last press started. */
export interface PagerControl {
  /** A load starts that no press asked for (the screen refetches). */
  readonly start: () => void;
  /** The page arrived. */
  readonly finish: () => void;
  /** The page could not be loaded. */
  readonly fail: () => void;
}

export interface PagerPagesProps {
  readonly ref: Ref<PagerControl>;
  /** Told each cursor the pager asked for. */
  readonly onCursor?: (cursor: string | undefined) => void;
}

export function PagerPages({ ref, onCursor }: PagerPagesProps) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [onScreen, setOnScreen] = useState<string | undefined>(undefined);
  const [state, setState] = useState<LoadState>('idle');
  useImperativeHandle(
    ref,
    () => ({
      start: () => {
        setState('loading');
      },
      finish: () => {
        setOnScreen(cursor);
        setState('idle');
      },
      fail: () => {
        setState('failed');
      },
    }),
    [cursor],
  );
  return (
    <>
      <button type="button">Elsewhere</button>
      <CursorPager
        cursor={cursor}
        nextCursor={NEXT.get(onScreen) ?? null}
        loading={state === 'loading'}
        failed={state === 'failed'}
        onCursorChange={(next) => {
          onCursor?.(next);
          setCursor(next);
          setState('loading');
        }}
      />
    </>
  );
}
