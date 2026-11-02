// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Outlet } from '@tanstack/react-router';
import { SessionEndedBanner, UserMenu } from '../auth/index.ts';

/**
 * What every route renders inside (E17-S08): the banner that says the session ended, the user menu, and the page in a `main`
 * landmark. The application shell of E17-S09 grows from here with the header, the navigation and the footer.
 */
export function RootLayout() {
  return (
    <>
      <SessionEndedBanner />
      <div className="flex justify-end p-4">
        <UserMenu />
      </div>
      <main className="mx-auto max-w-2xl p-6">
        <Outlet />
      </main>
    </>
  );
}
