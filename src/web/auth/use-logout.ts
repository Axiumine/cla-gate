// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { authFor } from './auth.ts';
import { useApiClient } from './hooks.ts';

export interface Logout {
  /** Sends the logout; while one is under way another click sends nothing. */
  readonly run: () => void;
  readonly isPending: boolean;
  /** Why the last logout failed, or `null`. */
  readonly error: Error | null;
}

/**
 * Logging out (E17-S08): `POST /api/auth/logout` through the client, with no body (the call sends neither a body nor a
 * `content-type`, because the server answers an empty body labelled JSON with a 400) and the CSRF token the client adds.
 * On success the whole query cache is cleared, so no data of the session that ended stays in memory, and the app goes to the
 * front page. The mutation's own callbacks run even when the button that started it is gone by then.
 */
export function useLogout(): Logout {
  const queryClient = useQueryClient();
  const client = useApiClient();
  const navigate = useNavigate();
  // A click that comes before the page has rendered the pending state (a double click) must still send nothing.
  const sending = useRef(false);
  const mutation = useMutation({
    mutationFn: () => client.call(logoutRoute),
    onSuccess: async () => {
      authFor(queryClient).signedOut();
      await navigate({ to: '/' });
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  return {
    run: () => {
      if (sending.current) {
        return;
      }
      sending.current = true;
      mutation.mutate();
    },
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
