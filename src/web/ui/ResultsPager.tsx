// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CursorPager } from './CursorPager.tsx';

/** What the pager reads of a page of a list: its rows and the cursor of the next page. */
export interface PagerPage {
  readonly items: readonly unknown[];
  readonly nextCursor: string | null;
}

export interface ResultsPagerProps {
  /** The page on screen, once there is one. */
  readonly shown: PagerPage | undefined;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** The page asked for is on its way. */
  readonly loading: boolean;
  /** The page asked for could not be loaded, and the one on screen is kept. */
  readonly failed: boolean;
  readonly onCursorChange: (cursor: string | undefined) => void;
}

/** The pager under a table (E18-S07, E18-S08): there when the page on screen has rows, with no total, because the endpoints count none. */
export function ResultsPager({ shown, cursor, loading, failed, onCursorChange }: ResultsPagerProps) {
  return shown === undefined || shown.items.length === 0 ? null : (
    <CursorPager
      cursor={cursor}
      nextCursor={shown.nextCursor}
      onCursorChange={onCursorChange}
      loading={loading}
      failed={failed}
    />
  );
}
