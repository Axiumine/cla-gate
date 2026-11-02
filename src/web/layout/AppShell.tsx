// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useRef } from 'react';
import { SessionEndedBanner, UserMenu } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { PrimaryNav } from './PrimaryNav.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import { useFocusOnNavigation } from './use-focus-on-navigation.ts';
import { useHeaderSlot, usePageTitle } from './use-page.ts';

export interface AppShellProps {
  /** The router's matches: the page, or the error or not-found state in its place. */
  readonly children: ReactNode;
}

/**
 * The frame of every page (E17-S09), the router's `InnerWrap`: it sits above the route boundaries, so a page that crashes
 * is replaced by the error state inside the shell and the header, the user menu and the footer stay. It draws the landmarks
 * (`header`, `nav`, `main` and `footer`) with a "Skip to content" link as the first focusable element (a plain fragment link:
 * the browser moves focus to `<main>`, which can take it because of its `tabindex="-1"`), the session banner of
 * E17-S08, the header slot of the route that is showing, and a polite live region that says the title of each new page.
 * After every navigation focus goes to the page's `<h1>`, or to `<main>` when it has none.
 */
export function AppShell({ children }: AppShellProps) {
  const t = useT();
  const main = useRef<HTMLElement>(null);
  const title = usePageTitle();
  const headerSlot = useHeaderSlot();
  useFocusOnNavigation(main);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('nav.skip')}
      </a>
      <SessionEndedBanner />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="text-lg font-semibold">{t('app.name')}</span>
          <PrimaryNav />
          <div className="flex flex-wrap items-center gap-4 md:ms-auto">
            {headerSlot}
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={main} className="mx-auto w-full max-w-2xl flex-1 p-6">
        {children}
      </main>
      <SourceFooter />
      <StatusMessage visuallyHidden>{title}</StatusMessage>
    </div>
  );
}
