// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { AppStep } from './AppStep.tsx';
import { NoReferrer } from './NoReferrer.tsx';
import { SetupGate } from './SetupGate.tsx';
import { UnlockStep } from './UnlockStep.tsx';

/** The two steps of the page: the unlock, and once the token was accepted, the form with the CSRF token of the session it opened. */
function SetupFlow() {
  const [csrfToken, setCsrfToken] = useState<string | undefined>(undefined);
  return csrfToken === undefined ? <UnlockStep onUnlocked={setCsrfToken} /> : <AppStep csrfToken={csrfToken} />;
}

/**
 * The page at `/setup` (E19-S07), public: the browser side of the first-run setup (E19-S06). It asks for the status first (a
 * configured server has no setup, and the page is the not-found page), then the unlock, then the form, and ends by posting the
 * manifest to GitHub, which sends the browser to `/setup/callback`.
 */
export function SetupPage() {
  return (
    <>
      <NoReferrer />
      <SetupGate>
        <SetupFlow />
      </SetupGate>
    </>
  );
}
