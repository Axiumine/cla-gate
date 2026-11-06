// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Controller } from 'react-hook-form';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { type PlainMessageKey, useT } from '../i18n/index.ts';
import { Field } from '../ui/Field.tsx';
import { RadioGroup } from '../ui/RadioGroup.tsx';
import { UserText } from '../ui/UserText.tsx';
import type { FieldProps } from './ConsentFields.tsx';

/** The words under the address choice for a refusal of the server, by its rule; any other error is "choose one". */
const EMAIL_MESSAGES: ReadonlyMap<string, PlainMessageKey> = new Map([
  ['email_not_verified', 'sign.email.notVerified'],
  ['no_verified_email', 'sign.email.none'],
]);

/** The choice among the verified addresses: there is no field to type one. */
export function EmailField({
  control,
  errors,
  emails,
}: FieldProps & { readonly emails: SignContextResponse['emails'] }) {
  const t = useT();
  const type = errors.email?.type;
  const message = type === undefined ? undefined : t(EMAIL_MESSAGES.get(type) ?? 'sign.email.required');
  return (
    <Controller
      control={control}
      name="email"
      render={({ field }) => (
        <Field label={t('sign.email.label')} description={t('sign.email.help')} error={message} required>
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            options={emails.map(({ email, primary }) => ({
              value: email,
              label: (
                <>
                  <UserText>{email}</UserText>
                  {primary ? <span className="text-fg-muted"> ({t('sign.email.primary')})</span> : null}
                </>
              ),
            }))}
          />
        </Field>
      )}
    />
  );
}
