// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { installationsQueryOptions } from './installation-queries.ts';

/** The installations the signed-in person administers (E14-S01): one query, shared by the list, the switcher and the banner. */
export function useInstallations(): UseQueryResult<InstallationSummary[]> {
  return useQuery(installationsQueryOptions(useApiClient()));
}

/**
 * The summary of one installation as the list of the person has it, or `undefined` while the list is not there and for an
 * installation it does not hold. It only decorates a tenant's screen (the banner, the title); that the person may open the
 * tenant is decided by the server on each request, never by this lookup.
 */
export function useInstallation(installationId: number): InstallationSummary | undefined {
  return useInstallations().data?.find((installation) => installation.id === installationId);
}
