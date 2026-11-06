// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type SyntheticEvent, useState } from 'react';
import type { z } from 'zod';
import { normaliseRationale } from '../../shared/cla-version.ts';
import { recordOverrideRoute } from '../../shared/pending-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { isRule } from '../documents/document-rules.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { overridesKey, pendingKey } from './pending-queries.ts';

/** The body of a record, as the contract has it. */
type RecordBody = z.infer<typeof recordOverrideRoute.body>;

export interface RecordOverrideInput {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `repositories.id` of the repository of the pending pull request: the record is addressed through it. */
  readonly repositoryId: number;
  /** The commit the pending list names. */
  readonly commitSha: string;
  /** Runs once the server has stored the override and the lists have been asked for again. */
  readonly onRecorded: () => void;
}

/** The record request: never optimistic; the pending list and the overrides are asked for again once the override is stored. */
function useRecordRequest({ installationId, repositoryId, onRecorded }: RecordOverrideInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: RecordBody) => client.call(recordOverrideRoute, { params: { repositoryId }, body }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingKey(installationId) }),
        queryClient.invalidateQueries({ queryKey: overridesKey(installationId) }),
      ]);
      onRecorded();
    },
  });
}

/**
 * The state and the request of the override dialog (E18-S08). The reason is checked with the cleaning the server applies
 * (`normaliseRationale`: trimmed, 1 to 2000 characters, no control characters) and the commit with the shared schema of the request
 * (the full 40 or 64 hexadecimal characters) before anything is sent, so nothing that cannot be an override leaves the browser. The
 * rules the server breaks come back and are put where the person was typing; editing the reason clears them. The request is sent once at a time,
 * and `sendValues` sends the override the values stand for, which is also how a failed record is tried again.
 */
export function useRecordOverride(input: RecordOverrideInput) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const mutation = useRecordRequest(input);
  const sendRequest = useSingleFlight(mutation);
  const clean = normaliseRationale(reason);
  const commit = recordOverrideRoute.body.shape.commitSha.safeParse(input.commitSha);
  const sendValues = () => {
    if (clean !== null && commit.success) {
      sendRequest({ commitSha: commit.data, reason: clean });
    }
  };
  const error = mutation.isError ? mutation.error : undefined;
  const reasonInvalid = (attempted && clean === null) || isRule(error, 'invalid_reason');
  const commitInvalid = (attempted && !commit.success) || isRule(error, 'invalid_commit_sha');
  return {
    reason,
    changeReason: (text: string) => {
      setReason(text);
      mutation.reset();
    },
    reasonInvalid,
    commitInvalid,
    submit: (event: SyntheticEvent) => {
      event.preventDefault();
      setAttempted(true);
      sendValues();
    },
    sendValues,
    pending: mutation.isPending,
    failure: reasonInvalid || commitInvalid ? undefined : error,
  };
}
