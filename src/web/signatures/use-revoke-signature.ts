// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { signatureRevokeRoute } from '../../shared/signature-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { isRule } from '../documents/document-rules.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { signaturesKey } from './signature-queries.ts';

/** The reason codes of a revocation, as the contract has them. */
export type RevokeReason = z.infer<typeof signatureRevokeRoute.body>['reasonCode'];

/** What a revocation came to: the signature is revoked because of it, or was revoked already. */
export type RevokeOutcome = 'revoked' | 'alreadyRevoked';

export interface RevokeSignatureInput {
  /** `installations.id` of the tenant in the address: the revocation is addressed through it. */
  readonly installationId: number;
  /** `signatures.id` of the row. */
  readonly signatureId: number;
  /** Told how a revocation ended, once the list has been asked for again. */
  readonly onOutcome: (outcome: RevokeOutcome) => void;
}

/** `409 already_revoked`: the signature was revoked by somebody else, or by another click: nothing changed and the list is out of date. */
function isAlreadyRevoked(error: unknown): boolean {
  return isRule(error, 'already_revoked');
}

/**
 * The revocation of one signature (E18-S07): `POST .../installations/:installationId/signatures/:signatureId/revoke` with the reason
 * code, sent once at a time (a double click is one request) and never optimistic: the row says `Revoked` when the list that is asked
 * for again says so, and the outcome is told when the rows on screen are the new ones. `already_revoked` is an outcome of its own and
 * asks for the list again too. Any other failure (a `403`, a `404` for a signature this tenant does not have, GitHub down) is `failure`,
 * which the dialog shows and a new attempt clears; it leaves the list as it is.
 */
export function useRevokeSignature({ installationId, signatureId, onOutcome }: RevokeSignatureInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: signaturesKey(installationId) });
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (reasonCode: RevokeReason) =>
      client.call(signatureRevokeRoute, { params: { installationId, signatureId }, body: { reasonCode } }),
    onSuccess: async () => {
      await refresh();
      onOutcome('revoked');
    },
    onError: async (error) => {
      if (isAlreadyRevoked(error)) {
        await refresh();
        onOutcome('alreadyRevoked');
      }
    },
  });
  const send = useSingleFlight(mutation);
  return {
    revoke: send,
    pending: mutation.isPending,
    failure: mutation.isError && !isAlreadyRevoked(mutation.error) ? mutation.error : undefined,
    reset: mutation.reset,
  };
}
