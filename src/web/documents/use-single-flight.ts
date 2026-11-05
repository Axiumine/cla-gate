// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseMutationResult } from '@tanstack/react-query';
import { useRef } from 'react';

/**
 * A `send` for `mutation` that sends nothing while an earlier send has not settled (E18-S05): a double click, or the Enter key
 * repeating, sends one request. The guard is a ref and not the mutation's own `isPending`, which changes only after the next
 * render, so a second event that arrives before it would pass.
 */
export function useSingleFlight<Data, Variables>(
  mutation: Pick<UseMutationResult<Data, Error, Variables>, 'mutate'>,
): (variables: Variables) => void {
  const sending = useRef(false);
  return (variables) => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    mutation.mutate(variables, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };
}
