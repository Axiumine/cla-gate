// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { I18nProvider, useT } from './i18n/index.ts';

/** The page of the app for now: a heading. The router, the shell and the other providers arrive with E17-S04 to E17-S09. */
function Home() {
  const t = useT();
  return (
    <main>
      <h1>{t('app.name')}</h1>
    </main>
  );
}

/** The root of the app: the providers, then the page. The i18n provider is outermost, so every fallback can show text. */
export function App() {
  return (
    <I18nProvider>
      <Home />
    </I18nProvider>
  );
}
