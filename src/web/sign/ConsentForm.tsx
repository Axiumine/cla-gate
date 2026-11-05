// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Ref } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { Heading } from '../ui/Heading.tsx';
import { ConsentField, NameField } from './ConsentFields.tsx';
import { EmailField } from './EmailField.tsx';
import { StaleBanner } from './StaleBanner.tsx';
import { type ConsentHandlers, useConsentForm } from './use-consent-form.ts';

export interface ConsentFormProps {
  readonly context: SignContextResponse;
  readonly handlers: ConsentHandlers;
  /** The context is being loaded again: "Review the new version" is busy. */
  readonly reloading: boolean;
  /** The heading of the form, for the page to focus when the state changes. */
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
}

/**
 * The form that records the consent (E18-S01): the box with the consent sentence the server sent, the typed full name, and the
 * choice among the verified addresses (preselected when there is one). There is no field to type an address. The button is
 * off until the form is valid, busy while the request is under way, and the typed values stay through a refusal. When the text
 * changed while the person read (E18-S02), a banner says so above the fields, the consent box is clear, the name stays, and the
 * button stays off until the new version is on screen.
 */
export function ConsentForm({ context, handlers, reloading, headingRef }: ConsentFormProps) {
  const t = useT();
  const { form, submit, pending, failure, stale, review } = useConsentForm(context, handlers);
  const { control, register, formState } = form;
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.form.title')}
      </Heading>
      {stale ? (
        <StaleBanner
          reviewing={reloading}
          onReview={() => {
            void review();
          }}
        />
      ) : null}
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
        <Button type="submit" variant="primary" loading={pending} disabled={!formState.isValid || stale}>
          {t('sign.submit')}
        </Button>
      </div>
    </form>
  );
}
