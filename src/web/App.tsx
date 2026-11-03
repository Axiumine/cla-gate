// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { createQueryClient } from './api/query-client.ts';
import { AppProviders } from './providers.tsx';
import { AppRouter } from './router.tsx';
import { RootErrorBoundary } from './states/index.ts';

/**
 * The root of the app: the providers (the query cache is made once, here), then the router inside the root error boundary
 * (E17-S07), which sits below the providers so its fallback has text and a theme. The shell and its footer (E17-S09) are
 * the router's `InnerWrap`, above the route boundaries; if the shell itself fails the boundary's fallback has the footer too.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppProviders queryClient={queryClient}>
      <RootErrorBoundary>
        <AppRouter />
      </RootErrorBoundary>
    </AppProviders>
  );
}
