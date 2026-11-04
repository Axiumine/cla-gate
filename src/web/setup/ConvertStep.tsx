// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { SETUP_ERROR_CODES, setupConvertRoute } from '../../shared/setup.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { Credentials } from './Credentials.tsx';
import type { CallbackParams } from './callback-params.ts';
import { SetupError } from './SetupError.tsx';
import { StepHeading } from './StepHeading.tsx';
import { setupClient, withSetupCode } from './setup-api.ts';
import { useClearOnLeave } from './use-clear-on-leave.ts';

export interface ConvertStepProps {
  /** The CSRF token of the setup session, read again from the server after GitHub's round trip. */
  readonly csrfToken: string;
  /** The `code` and `state` GitHub put in the address, kept from before the address was cleaned. */
  readonly params: CallbackParams;
}

/**
 * The conversion (E19-S07): a button, and what it brings. Nothing is sent until the button is pressed, so a GET of this page
 * never uses the single-use code (a link prefetcher, a double-run effect). The press sends one request: the button is busy
 * and ignores clicks while it is under way, and a second click before the page has drawn that is stopped by the guard.
 * The credentials live only in the result of this mutation, which is kept for no time once nothing observes it
 * (`gcTime: 0`) and is cleared when the component unmounts and when the page is hidden.
 */
export function ConvertStep({ csrfToken, params }: ConvertStepProps) {
  const t = useT();
  const client = useMemo(() => setupClient(csrfToken), [csrfToken]);
  const sending = useRef(false);
  const convert = useMutation({
    mutationFn: () => withSetupCode(client.call(setupConvertRoute, { body: params }), SETUP_ERROR_CODES.locked),
    gcTime: 0,
    onSettled: () => {
      sending.current = false;
    },
  });
  useClearOnLeave(convert.reset);
  const run = () => {
    if (!sending.current) {
      sending.current = true;
      convert.mutate();
    }
  };
  if (convert.isSuccess) {
    return <Credentials result={convert.data} />;
  }
  return (
    <div className="flex flex-col items-start gap-4">
      <StepHeading>{t('setup.callback.title')}</StepHeading>
      <p>{t('setup.callback.intro')}</p>
      <Button variant="primary" loading={convert.isPending} onClick={run}>
        {t('setup.callback.get')}
      </Button>
      {convert.isError ? <SetupError error={convert.error} retry={run} retrying={convert.isPending} /> : null}
    </div>
  );
}
