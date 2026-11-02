// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { createQueryClient } from './api/query-client.ts';
import { useT } from './i18n/index.ts';
import { AppProviders } from './providers.tsx';

/** The page of the app for now: a heading. The router and the shell arrive with E17-S08 and E17-S09. */
function Home() {
  const t = useT();
  return (
    <main>
      <h1>{t('app.name')}</h1>
    </main>
  );
}

/** The root of the app: the providers (the query cache is made once, here), then the page. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppProviders queryClient={queryClient}>
      <Home />
    </AppProviders>
  );
}
