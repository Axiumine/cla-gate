// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { pageNumber, type Step, trailTo } from './cursor-trail.ts';

interface TrailInput {
  readonly cursor: string | undefined;
  readonly nextCursor: string | null;
  readonly onCursorChange: (cursor: string | undefined) => void;
}

/**
 * The moves of a cursor pager (E17-S10) from the page on screen, whose cursor is `cursor`: `forward` hands the screen the
 * cursor the server gave for the next page, `back` hands it the cursor of the page before, and each is `undefined` where
 * there is no such page. `page` is the number of the page on screen, or `undefined` when the pager cannot count (it was not
 * there when the person got to this page).
 */
export function useCursorTrail({ cursor, nextCursor, onCursorChange }: TrailInput) {
  const [visited, setVisited] = useState<readonly Step[]>([]);
  const trail = trailTo(visited, cursor);
  const earlier = trail.at(-1);
  return {
    page: pageNumber(trail, cursor),
    back:
      earlier === undefined
        ? undefined
        : () => {
            onCursorChange(earlier.from);
          },
    forward:
      nextCursor === null
        ? undefined
        : () => {
            setVisited([...trail, { from: cursor, to: nextCursor }]);
            onCursorChange(nextCursor);
          },
  };
}

/**
 * `value` once `settled`, and the last value that was settled until then: what a live region says about a page names the
 * page that arrived, not the one being fetched. The remembered value is state set during render, which React allows for a
 * value derived from props and which does not cost a render of its own.
 */
export function useSettled<Value>(value: Value, settled: boolean): Value {
  const [remembered, setRemembered] = useState(value);
  if (settled && remembered !== value) {
    setRemembered(value);
  }
  return settled ? value : remembered;
}
