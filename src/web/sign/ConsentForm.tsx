// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { Heading } from '../ui/Heading.tsx';
import type { Signed } from './Confirmation.tsx';
import { ConsentField, NameField } from './ConsentFields.tsx';
import { EmailField } from './EmailField.tsx';
import { useConsentForm } from './use-consent-form.ts';

export interface ConsentFormProps {
  readonly context: SignContextResponse;
  /** Called once the signature is recorded (a new one, or the earlier one that already covers the person). */
  readonly onSigned: (signed: Signed) => void;
}

/**
 * The form that records the consent (E18-S01): the box with the consent sentence the server sent, the typed full name, and the
 * choice among the verified addresses (preselected when there is one). There is no field to type an address. The button is
 * off until the form is valid, busy while the request is under way, and the typed values stay through a refusal.
 */
export function ConsentForm({ context, onSigned }: ConsentFormProps) {
  const t = useT();
  const { form, submit, pending, failure } = useConsentForm(context, onSigned);
  const { control, register, formState } = form;
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <Heading level={2}>{t('sign.form.title')}</Heading>
      <ConsentField control={control} errors={formState.errors} sentence={context.consent.text} />
      <NameField register={register} errors={formState.errors} />
      <EmailField control={control} errors={formState.errors} emails={context.emails} />
      {failure === undefined ? null : (
        <ErrorState
          error={failure}
          level={3}
          refetch={() => {
            void submit();
          }}
        />
      )}
      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={!formState.isValid}>
          {t('sign.submit')}
        </Button>
      </div>
    </form>
  );
}
