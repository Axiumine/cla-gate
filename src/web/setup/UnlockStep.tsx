// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import { type SyntheticEvent, useState } from 'react';
import { SETUP_ERROR_CODES, setupUnlockRoute } from '../../shared/setup.ts';
import { useApiClient } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { StepHeading } from './StepHeading.tsx';
import { withSetupCode } from './setup-api.ts';

export interface UnlockStepProps {
  /** Called with the CSRF token of the setup session once the token was accepted. */
  readonly onUnlocked: (csrfToken: string) => void;
}

/**
 * The first step of the setup (E19-S07): a password field labelled "Setup token", where the person pastes the content of
 * `secrets/setup_token`. The token goes to `POST /api/setup/unlock` in the JSON body; it is never put in a URL: the field has
 * no `name` and the form no `action`, so not even a submit that the script did not handle could carry it into an address.
 * A wrong token, a held-back client and the other failures get their message from the catalog.
 */
export function UnlockStep({ onUnlocked }: UnlockStepProps) {
  const t = useT();
  const client = useApiClient();
  const [token, setToken] = useState('');
  const unlock = useMutation({
    mutationFn: (value: string) =>
      withSetupCode(client.call(setupUnlockRoute, { body: { token: value } }), SETUP_ERROR_CODES.invalidToken),
    onSuccess: ({ csrfToken }) => {
      setToken('');
      onUnlocked(csrfToken);
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (token !== '' && !unlock.isPending) {
      unlock.mutate(token);
    }
  };
  return (
    <div className="flex flex-col items-start gap-4">
      <StepHeading>{t('setup.unlock.title')}</StepHeading>
      <p>{t('setup.unlock.intro')}</p>
      <form onSubmit={submit} noValidate className="flex w-full flex-col items-start gap-4">
        <div className="w-full">
          <Field label={t('setup.unlock.token')}>
            <TextInput
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={unlock.isPending}>
          {t('setup.unlock.submit')}
        </Button>
      </form>
      {unlock.isError ? <ErrorState variant="banner" error={unlock.error} /> : null}
    </div>
  );
}
