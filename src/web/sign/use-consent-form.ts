// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type BaseSyntheticEvent, useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { type SignRequest, signRoute } from '../../shared/sign.ts';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { useApiClient } from '../auth/index.ts';
import type { Signed } from './Confirmation.tsx';
import {
  buildSignRequest,
  type ConsentFormValues,
  consentResolver,
  fieldOfRule,
  initialValues,
  signerRuleOf,
} from './consent-form.ts';
import { signContextScope } from './sign-queries.ts';

/** The text the person is agreeing to, as the server identifies it: its version and the hash of its source. */
function textIdentity(context: SignContextResponse): string {
  return `${context.version.id}:${context.version.contentSha256}`;
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

/**
 * The consent form of the sign page and the request it sends (E18-S01). React Hook Form holds the values and checks them with
 * the shared schema; the request carries the version and the hash of the text on screen. While a request is under way another
 * submit sends nothing (a double click, the Enter key repeating). A refusal that is about the typed name or the address is put
 * on that field; any other failure is returned, for the error state. When the text on screen changes under the form, the
 * consent is withdrawn: it was given for the text the person read.
 */
export function useConsentForm(context: SignContextResponse, onSigned: (signed: Signed) => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const sending = useRef(false);
  const form = useForm<ConsentFormValues>({
    mode: 'onTouched',
    resolver: consentResolver,
    defaultValues: initialValues(context),
  });
  const { setError, setValue } = form;
  const withdraw = useCallback(() => {
    setValue('consent', false, { shouldValidate: true });
  }, [setValue]);
  useWithdrawnWhenTextChanges(textIdentity(context), withdraw);
  const mutation = useMutation({
    // The request holds the typed name and the chosen address: once nothing watches the mutation (the form is gone) it goes.
    gcTime: 0,
    mutationFn: (request: SignRequest) => client.call(signRoute, { body: request }),
    onSuccess: (response, request) => {
      // Marked out of date and not asked again now: the answer would change the page under the confirmation.
      void queryClient.invalidateQueries({
        queryKey: signContextScope(context.repository.githubRepoId),
        refetchType: 'none',
      });
      onSigned({ response, name: request.name });
    },
    onError: (error) => {
      const rule = signerRuleOf(error);
      if (rule !== undefined) {
        setError(fieldOfRule(rule), { type: rule }, { shouldFocus: true });
      }
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const send = (values: ConsentFormValues) => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    mutation.mutate(buildSignRequest(context, values));
  };
  // The handler is made when the form is submitted, not while the component renders: it reads a ref.
  const submit = (event?: BaseSyntheticEvent) => form.handleSubmit(send)(event);
  const failure = mutation.isError && signerRuleOf(mutation.error) === undefined ? mutation.error : undefined;
  return { form, submit, pending: mutation.isPending, failure };
}
