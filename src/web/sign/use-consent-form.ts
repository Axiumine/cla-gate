// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type BaseSyntheticEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import type { Signed } from './Confirmation.tsx';
import { type ConsentFormValues, consentResolver, initialValues } from './consent-form.ts';
import { isShownByPage, useSignRequest } from './use-sign-request.ts';

/** The text the person is agreeing to, as the server identifies it: its version, the hash of its source, and the consent sentence. */
function textIdentity(context: SignContextResponse): string {
  return `${context.version.id}:${context.version.contentSha256}:${context.consent.id}`;
}

/** Runs `withdraw` when `identity` changes after the first render: the consent was given for the text that was shown. */
function useWithdrawnWhenTextChanges(identity: string, withdraw: () => void): void {
  const shown = useRef(identity);
  useEffect(() => {
    if (shown.current !== identity) {
      shown.current = identity;
      withdraw();
    }
  }, [identity, withdraw]);
}

/** What the form needs from the page around it (E18-S02). */
export interface ConsentHandlers {
  /** Called once the signature is recorded (a new one, or the earlier one that already covers the person). */
  readonly onSigned: (signed: Signed) => void;
  /** Called when the server says the repository has no CLA in force any more. */
  readonly onNoActiveCla: () => void;
  /** Loads the context in force again and shows it; resolves true when it is there. */
  readonly review: () => Promise<boolean>;
}

/**
 * The consent form of the sign page and the request it sends (E18-S01, E18-S02). React Hook Form holds the values and checks
 * them with the shared schema; the request carries the version and the hash of the text on screen. While a request is under way
 * another submit sends nothing. A refusal that is about the typed name or the address is put on that field; any other failure
 * is returned, for the error state. When the text on screen changes under the form, the consent is withdrawn: it was given for
 * the text the person read. When the server says that text is out of date, the consent is withdrawn at once, the typed name stays,
 * and nothing is sent until the new version is on screen (`stale`, cleared by `review` or by the text changing).
 */
export function useConsentForm(context: SignContextResponse, handlers: ConsentHandlers) {
  const [stale, setStale] = useState(false);
  const form = useForm<ConsentFormValues>({
    mode: 'onTouched',
    resolver: consentResolver,
    defaultValues: initialValues(context),
  });
  const { setValue } = form;
  const withdraw = useCallback(() => {
    setValue('consent', false, { shouldValidate: true });
  }, [setValue]);
  const textChanged = useCallback(() => {
    withdraw();
    setStale(false);
  }, [withdraw]);
  useWithdrawnWhenTextChanges(textIdentity(context), textChanged);
  const { mutation, send } = useSignRequest(context, form, {
    onSigned: handlers.onSigned,
    onNoActiveCla: handlers.onNoActiveCla,
    onStale: () => {
      withdraw();
      setStale(true);
    },
    stale,
  });
  // The handler is made when the form is submitted, not while the component renders: it reads a ref.
  const submit = (event?: BaseSyntheticEvent) => form.handleSubmit(send)(event);
  const review = async () => {
    if (await handlers.review()) {
      setStale(false);
    }
  };
  const failure = mutation.isError && !isShownByPage(mutation.error) ? mutation.error : undefined;
  return { form, submit, pending: mutation.isPending, failure, stale, review };
}
