// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { corporateAgreementListRoute } from '../../shared/corporate.ts';
import { useApiClient } from '../auth/index.ts';

/**
 * The page of the corporate agreements of the signed-in person at `cursor` (E21-S02). The page on screen stays until the next one
 * is there. The key starts with the one that signing invalidates.
 */
export function useAgreements(cursor: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['corporate', 'agreements', cursor ?? null],
    queryFn: ({ signal }) =>
      client.call(corporateAgreementListRoute, { query: cursor === undefined ? {} : { cursor } }, { signal }),
    placeholderData: keepPreviousData,
  });
}
