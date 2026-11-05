// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CursorPager } from '../ui/index.ts';
import type { SignaturePage } from './signature-queries.ts';

export interface ResultsPagerProps {
  /** The page on screen, once there is one. */
  readonly shown: SignaturePage | undefined;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** The page asked for is on its way. */
  readonly loading: boolean;
  /** The page asked for could not be loaded, and the one on screen is kept. */
  readonly failed: boolean;
  readonly onCursorChange: (cursor: string | undefined) => void;
}

/** The pager under the table (E18-S07): there when the page on screen has rows, with no total, because the endpoint counts none. */
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
