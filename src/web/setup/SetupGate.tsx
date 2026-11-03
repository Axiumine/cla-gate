// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { setupStatusRoute } from '../../shared/setup.ts';
import { useApiClient } from '../auth/index.ts';
import { NotFoundPage, QueryBoundary } from '../states/index.ts';

/** The key of the status query. */
const STATUS_KEY = ['setup', 'status'] as const;

export interface SetupGateProps {
  readonly children: ReactNode;
}

/**
 * What a setup page asks first (E19-S07): `GET /api/setup/status`. In `setup` mode the page is shown; in `configured` mode
 * there is no setup, and the page is the shared not-found page, like the server's own `404` for these paths. The answer
 * cannot change without a restart, so it is asked once and not again when the window gets focus.
 */
export function SetupGate({ children }: SetupGateProps) {
  const client = useApiClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => client.call(setupStatusRoute, undefined, { signal }),
    refetchOnWindowFocus: false,
  });
  return <QueryBoundary query={status}>{({ mode }) => (mode === 'setup' ? children : <NotFoundPage />)}</QueryBoundary>;
}
