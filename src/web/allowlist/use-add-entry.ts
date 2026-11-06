// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type SyntheticEvent, useState } from 'react';
import { ALLOWLIST_LOGIN_PATTERN, type AllowlistEntryRequest } from '../../shared/allowlist.ts';
import { addInstallationEntryRoute, addRepositoryEntryRoute } from '../../shared/allowlist-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { allowlistKey } from './allowlist-queries.ts';
import { type AddRule, loginRuleOf } from './allowlist-rules.ts';
import type { EntryKind } from './KindField.tsx';

/** The values of the dialog: what the entry exempts, and the login typed for a user or a bot. */
interface AddValues {
  readonly kind: EntryKind;
  readonly login: string;
}

/** The request a set of values stands for: the login is trimmed, and the members of the organisation have none. */
function requestOf({ kind, login }: AddValues): AllowlistEntryRequest {
  return kind === 'org_members' ? { kind } : { kind, login: login.trim() };
}

export interface AddEntryInput {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The repository the entry is for (`repositories.id`), or `undefined` for the whole installation: one endpoint per scope. */
  readonly repositoryId: number | undefined;
  /** Runs once the server has stored the entry, after the list has been asked for again. */
  readonly onAdded: () => void;
}

/** The add request: one endpoint per scope, never optimistic; the list is asked for again once the entry is stored. */
function useAddRequest({ installationId, repositoryId, onAdded }: AddEntryInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: AllowlistEntryRequest) =>
      repositoryId === undefined
        ? client.call(addInstallationEntryRoute, { params: { installationId }, body })
        : client.call(addRepositoryEntryRoute, { params: { repositoryId }, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: allowlistKey(installationId) });
      onAdded();
    },
  });
}

/**
 * The state and the request of the add dialog (E18-S06). A login that does not look like one (the shared pattern) is refused before
 * anything is sent, with its own words; the rules the server breaks come back and are put where the person was typing (the login) or
 * in the dialog, and editing a value clears them. The members of the organisation are asked about first (`confirming`): the request is
 * sent when the person confirms. The request is sent once at a time, and `sendValues` sends the entry the values stand for, which is also how a failed add is tried again.
 */
export function useAddEntry(input: AddEntryInput) {
  const [values, setValues] = useState<AddValues>({ kind: 'user', login: '' });
  const [loginRefused, setLoginRefused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mutation = useAddRequest(input);
  const sendRequest = useSingleFlight(mutation);
  const sendValues = () => {
    sendRequest(requestOf(values));
  };
  const error = mutation.isError ? mutation.error : undefined;
  const loginRule: 'invalid_login' | AddRule | undefined = loginRefused ? 'invalid_login' : loginRuleOf(error);
  return {
    values,
    change: (changes: Partial<AddValues>) => {
      setValues({ ...values, ...changes });
      setLoginRefused(false);
      mutation.reset();
    },
    submit: (event: SyntheticEvent) => {
      event.preventDefault();
      if (values.kind === 'org_members') {
        setConfirming(true);
        return;
      }
      const refused = !ALLOWLIST_LOGIN_PATTERN.test(values.login.trim());
      setLoginRefused(refused);
      if (!refused) {
        sendValues();
      }
    },
    confirming,
    setConfirming,
    sendValues,
    pending: mutation.isPending,
    loginRule,
    failure: loginRuleOf(error) === undefined ? error : undefined,
  };
}
