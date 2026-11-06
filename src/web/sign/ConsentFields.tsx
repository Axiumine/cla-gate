// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Control, Controller, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { useT } from '../i18n/index.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Field } from '../ui/Field.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { UserText } from '../ui/UserText.tsx';
import type { ConsentFormValues } from './consent-form.ts';

// The name and consent fields of the form (E18-S01), each a React Hook Form field drawn on the shared `Field`.

/** What each field of the form is given by React Hook Form. */
export interface FieldProps {
  readonly control: Control<ConsentFormValues>;
  readonly errors: FieldErrors<ConsentFormValues>;
}

/** The box beside the consent sentence the server sent. */
export function ConsentField({ control, errors, sentence }: FieldProps & { readonly sentence: string }) {
  const t = useT();
  return (
    <Controller
      control={control}
      name="consent"
      render={({ field }) => (
        <Field
          label={<UserText>{sentence}</UserText>}
          error={errors.consent === undefined ? undefined : t('sign.consent.required')}
          required
          inline
        >
          <Checkbox checked={field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />
        </Field>
      )}
    />
  );
}

/** The typed full name. */
export function NameField({
  register,
  errors,
}: { readonly register: UseFormRegister<ConsentFormValues> } & Pick<FieldProps, 'errors'>) {
  const t = useT();
  return (
    <Field
      label={t('sign.name.label')}
      description={t('sign.name.help')}
      error={errors.name === undefined ? undefined : t('sign.name.invalid')}
      required
    >
      <TextInput autoComplete="name" {...register('name')} />
    </Field>
  );
}
