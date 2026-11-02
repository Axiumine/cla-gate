// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nProvider } from './i18n/index.ts';
import { ThemeProvider } from './theme/index.ts';

export interface AppProvidersProps {
  /** The query cache of this app. The app makes one; a test passes its own, so it can read and clear it. */
  readonly queryClient: QueryClient;
  readonly children: ReactNode;
}

/**
 * Every provider the screens rely on, in one place that the app and the test helper share, so a test renders inside the
 * same providers as the app (E17-S04). Whatever the screens render sits inside the i18n provider, so an error fallback can
 * always show text; the theme provider (E17-S05) sits just inside it. The router joins here as E17-S08 lands.
 */
export function AppProviders({ queryClient, children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
