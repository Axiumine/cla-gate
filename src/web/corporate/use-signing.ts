// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type CorporateDocumentResponse, corporateAgreementCreateRoute } from '../../shared/corporate.ts';
import { useApiClient } from '../auth/index.ts';
import type { Entries } from './entries.ts';

/**
 * The request that signs the version on screen (E21-S02), and the list of agreements asked for again once it is signed. The body
 * names the version and the hash of the text the person read, so the server signs that text and no other.
 */
export function useSigning(document: CorporateDocumentResponse, onSigned: () => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (typed: Entries) =>
      client.call(corporateAgreementCreateRoute, {
        body: {
          githubRepoId: document.repository.githubRepoId,
          versionId: document.versionId,
          contentSha256: document.contentSha256,
          ...typed,
        },
      }),
    onSuccess: async () => {
      onSigned();
      await queryClient.invalidateQueries({ queryKey: ['corporate', 'agreements'] });
    },
  });
}
