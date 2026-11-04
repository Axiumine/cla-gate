// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ManifestRequest } from '../../shared/setup.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Field } from '../ui/Field.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { OwnerFields } from './OwnerFields.tsx';
import { useAppForm } from './use-app-form.ts';

export interface AppFormProps {
  /** Called with the request to send once the values passed the check. */
  readonly onSubmit: (request: ManifestRequest) => void;
  /** The request is under way: the button is busy and ignores clicks. */
  readonly submitting: boolean;
}

/** Whether the page was opened over https: the address the server answers at is `PUBLIC_BASE_URL`, and GitHub delivers webhooks to https only. */
function isSecurePage(): boolean {
  return window.location.protocol === 'https:';
}

/**
 * The form that collects what the manifest needs (E19-S07): personal account or organisation (the login field appears for the
 * latter only), the App name (offered as "CLA Gate <host>" cut to the characters and the length the server accepts) and
 * whether other organisations may install the App, with the reason a public App is needed. A page that was not opened over
 * https gets a warning.
 */
export function AppForm({ onSubmit, submitting }: AppFormProps) {
  const t = useT();
  const { form, values, wrong, change, submit } = useAppForm(onSubmit);
  return (
    <form ref={form} onSubmit={submit} noValidate className="flex w-full flex-col items-start gap-5">
      <OwnerFields values={values} wrong={wrong} change={change} />
      <div className="w-full">
        <Field
          label={t('setup.app.name')}
          description={t('setup.app.nameHelp')}
          error={wrong.has('appName') ? t('setup.app.nameInvalid') : undefined}
          required
        >
          <TextInput
            autoComplete="off"
            spellCheck={false}
            value={values.appName}
            onChange={(event) => {
              change({ appName: event.target.value });
            }}
          />
        </Field>
      </div>
      <Field label={t('setup.app.public')} description={t('setup.app.publicHelp')} inline>
        <Checkbox
          checked={values.allowOtherAccounts}
          onCheckedChange={(checked) => {
            change({ allowOtherAccounts: checked });
          }}
        />
      </Field>
      {isSecurePage() ? null : <StatusMessage tone="warning">{t('setup.app.httpWarning')}</StatusMessage>}
      <Button type="submit" variant="primary" loading={submitting}>
        {t('setup.app.submit')}
      </Button>
    </form>
  );
}
