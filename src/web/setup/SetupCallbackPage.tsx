// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SETUP_CALLBACK_PATH } from '../../shared/routes.ts';
import { SETUP_ERROR_CODES, setupSessionRoute } from '../../shared/setup.ts';
import { useApiClient } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { LoadingState } from '../states/index.ts';
import { ConvertStep } from './ConvertStep.tsx';
import { type CallbackParams, readCallbackParams } from './callback-params.ts';
import { NoReferrer } from './NoReferrer.tsx';
import { SetupError } from './SetupError.tsx';
import { SetupGate } from './SetupGate.tsx';
import { StartAgainLink } from './StartAgainLink.tsx';
import { StepHeading } from './StepHeading.tsx';
import { withSetupCode } from './setup-api.ts';

/** What a return that is not GitHub's says: nothing was asked of the server. */
function NotAReturn() {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-4">
      <StepHeading>{t('setup.callback.invalidTitle')}</StepHeading>
      <p>{t('setup.callback.invalid')}</p>
      <StartAgainLink />
    </div>
  );
}

/**
 * After GitHub's round trip the page has lost the CSRF token the unlock gave it; the setup cookie is still there, and the
 * session endpoint gives the token back (E19-S07). This is a read: it uses no code, so loading the page twice costs nothing.
 * The token is held for as long as the page uses it and no longer.
 */
function Return({ params }: { readonly params: CallbackParams }) {
  const client = useApiClient();
  const session = useQuery({
    queryKey: ['setup', 'session'],
    queryFn: ({ signal }) =>
      withSetupCode(client.call(setupSessionRoute, undefined, { signal }), SETUP_ERROR_CODES.locked),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (session.isError) {
    return <SetupError error={session.error} retry={session.refetch} retrying={session.isFetching} />;
  }
  return session.data === undefined ? (
    <LoadingState />
  ) : (
    <ConvertStep csrfToken={session.data.csrfToken} params={params} />
  );
}

/**
 * The page at `/setup/callback` (E19-S07), public: where GitHub sends the browser once the App is created from the manifest,
 * with a one-time `code` and the `state` of this setup in the address. The page reads both at once and replaces the address
 * with the bare path (`history.replaceState`), so neither stays in the address bar, the history or a copied link. The
 * conversion into credentials runs only when the person presses the button (see {@link ConvertStep}).
 */
export function SetupCallbackPage() {
  const [params] = useState(() => readCallbackParams(window.location.search));
  useEffect(() => {
    // type-coverage:ignore-next-line -- the DOM library types history.state as any; it goes back to replaceState untouched, so the router keeps its place
    window.history.replaceState(window.history.state, '', SETUP_CALLBACK_PATH);
  }, []);
  return (
    <>
      <NoReferrer />
      <SetupGate>{params === undefined ? <NotAReturn /> : <Return params={params} />}</SetupGate>
    </>
  );
}
