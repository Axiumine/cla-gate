// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { type SignRequest, signRoute } from '../../shared/sign.ts';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { useApiClient } from '../auth/index.ts';
import type { Signed } from './Confirmation.tsx';
import { buildSignRequest, type ConsentFormValues, fieldOfRule, signerRuleOf } from './consent-form.ts';
import { isNoActiveCla, isStaleRefusal } from './sign-failures.ts';
import { signContextScope } from './sign-queries.ts';

/** What happens to the page when the sign request ends in something other than a recorded signature (E18-S02). */
export interface SignRequestHandlers {
  /** The signature is recorded (a new one, or the earlier one that already covers the person). */
  readonly onSigned: (signed: Signed) => void;
  /** The server refused because the text on screen is no longer in force: nothing was recorded. */
  readonly onStale: () => void;
  /** The CLA stopped being in force while the person read it. */
  readonly onNoActiveCla: () => void;
}

/** Whether the page shows the failure itself (a field, the stale banner, the no-CLA state), so the error state must not. */
export function isShownByPage(error: unknown): boolean {
  return signerRuleOf(error) !== undefined || isStaleRefusal(error) || isNoActiveCla(error);
}

/**
 * The sign request (E18-S01, E18-S02): sent for values that passed the check, once at a time. While one is under way, and while
 * the text on screen is known to be out of date (`stale`), another submit sends nothing: a double click, the Enter key repeating,
 * or a consent given again before the new version is on screen. A refusal about the typed name or the address is put on that
 * field; a stale text and a withdrawn CLA go to the handlers.
 */
export function useSignRequest(
  context: SignContextResponse,
  form: UseFormReturn<ConsentFormValues>,
  options: SignRequestHandlers & { readonly stale: boolean },
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const sending = useRef(false);
  const { onSigned, onStale, onNoActiveCla, stale } = options;
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
        form.setError(fieldOfRule(rule), { type: rule }, { shouldFocus: true });
      } else if (isStaleRefusal(error)) {
        onStale();
      } else if (isNoActiveCla(error)) {
        onNoActiveCla();
      }
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const send = (values: ConsentFormValues) => {
    if (sending.current || stale) {
      return;
    }
    sending.current = true;
    mutation.mutate(buildSignRequest(context, values));
  };
  return { mutation, send };
}
