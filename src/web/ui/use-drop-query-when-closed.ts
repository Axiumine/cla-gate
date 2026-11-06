// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Drops the query `queryKey` from the cache whenever `open` is false (E18-S14). The question of a dialog asks the server for a count only
 * while it is open (the query is off while it is closed), but the component that holds the query stays mounted, so the cache would keep
 * the last answer: a count is an answer for the moment it was given, and it must not be shown again without being asked for.
 */
export function useDropQueryWhenClosed(open: boolean, queryKey: QueryKey): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!open) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  });
}
