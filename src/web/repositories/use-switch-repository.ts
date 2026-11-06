// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { disableRepositoryRoute, enableRepositoryRoute } from '../../shared/repository-routes.ts';
import { type RepositoryChangeTarget, useRepositoryChange } from './use-repository-change.ts';

/** The two calls that turn the check of a repository on and off. */
export type Switch = 'enable' | 'disable';

/**
 * Turning the CLA check of a repository on (`POST /api/repositories/:repositoryId/enable`, E14-S03) or off (`.../disable`, E14-S04),
 * addressed through the repository of the row. Neither takes a body. The answer says whether the repository enforces now and whether
 * the call changed it: a call that changed nothing is the outcome `unchanged`, not an error.
 */
export function useSwitchRepository(which: Switch, input: RepositoryChangeTarget) {
  return useRepositoryChange({
    ...input,
    request: (client, repositoryId) =>
      which === 'enable'
        ? client.call(enableRepositoryRoute, { params: { repositoryId } })
        : client.call(disableRepositoryRoute, { params: { repositoryId } }),
    outcomeOf: ({ changed, enabled }) => {
      if (!changed) {
        return 'unchanged';
      }
      return enabled ? 'enabled' : 'disabled';
    },
  });
}
