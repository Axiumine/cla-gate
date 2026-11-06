// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseMutationResult } from '@tanstack/react-query';
import { useRef } from 'react';

/**
 * A `send` for `mutation` that sends nothing while an earlier send has not settled (E18-S05): a double click, or the Enter key
 * repeating, sends one request. The guard is a ref and not the mutation's own `isPending`, which changes only after the next
 * render, so a second event that arrives before it would pass. It is opened by the promise of the request and not by a callback of
 * the call: TanStack Query drops the callbacks of a call once `reset()` has detached the observer, and a form resets the mutation
 * when a field is edited, which can happen while the request is still under way. The answer is shown by the mutation's own state, so
 * the rejection is not rethrown here.
 */
export function useSingleFlight<Data, Variables>(
  mutation: Pick<UseMutationResult<Data, Error, Variables>, 'mutateAsync'>,
): (variables: Variables) => void {
  const sending = useRef(false);
  return (variables) => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    const open = () => {
      sending.current = false;
    };
    void mutation.mutateAsync(variables).then(open, open);
  };
}
