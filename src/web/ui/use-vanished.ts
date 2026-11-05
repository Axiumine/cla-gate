// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useRef } from 'react';

/**
 * Runs `onVanished` when the component unmounts after `settle` was called (E18-S07): a row whose revocation went through, and that the
 * list no longer holds because it is filtered by another state, takes with it the button that had focus, and the screen has to put
 * focus somewhere. A component that unmounts for another reason (the person left the screen) runs nothing. The callback that runs is
 * the latest one given, so it needs no stable identity.
 */
export function useVanished(onVanished: () => void): () => void {
  const settled = useRef(false);
  const latest = useRef(onVanished);
  useEffect(() => {
    latest.current = onVanished;
  });
  useEffect(
    () => () => {
      if (settled.current) {
        latest.current();
      }
    },
    [],
  );
  return () => {
    settled.current = true;
  };
}
