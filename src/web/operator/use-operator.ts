// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/hooks.ts';
import { type OperatorView, operatorQueryOptions } from './operator-queries.ts';

/** Whether the signed-in person operates the instance, and if so the installations of the instance (E18-S13): one query, shared by the user menu and the page. */
export function useOperator(): UseQueryResult<OperatorView> {
  return useQuery(operatorQueryOptions(useApiClient()));
}
