// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createLogger } from '../../adapters/http/logger.ts';
import { captureLogs } from '../../test-support.ts';
import { id, installation } from '../github-contract/test-support.ts';
import { createOrgAdminLookup, type OrgAdminInstallation } from '../org-admin.ts';
import { createRepoAdminLookup, type RepoAdminInstallation, type RepoAdminRepository } from '../repo-admin.ts';
import { RoleCache } from '../role-cache.ts';
import { orgInstallation, tenantId, VIEWER_ID } from '../role-fixture/test-support.ts';
import { createViewerLookupBudget } from '../role-lookup-budget.ts';
import { createRoleLookups } from '../role-lookups.ts';
import { FakeClock, FakeGitHub } from '../test-support.ts';

// The role lookups with their cache in front, over the in-memory GitHub (E11-S04): tenant `n` is the organisation
// `org-<n>`, installation `n` in our table and `1000 + n` at GitHub, and the viewer of the role tests (numeric id 501,
// login `alice`) is an admin of the ones a test makes so.

const START = '2026-11-02T10:00:00.000Z';

/** The GitHub installation id of tenant `n`. */
export const githubInstallationOf = (n: number): number => 1000 + n;

/** Tenant `n` as its stored row reads: the organisation `org-<n>`. */
export function tenantRow(n: number): OrgAdminInstallation & { readonly id: ReturnType<typeof tenantId> } {
  return { ...orgInstallation(githubInstallationOf(n), `org-${n}`), id: tenantId(n) };
}

/** Repository `index` of tenant `n`: `org-<n>/repo-<index>`, whose GitHub id is `n * 1000 + index`. */
export function repositoryRow(
  n: number,
  index: number,
): RepoAdminInstallation & RepoAdminRepository & { readonly id: ReturnType<typeof tenantId>; github_repo_id: number } {
  return {
    id: tenantId(n),
    github_installation_id: githubInstallationOf(n),
    github_repo_id: n * 1000 + index,
    full_name: `org-${n}/repo-${index}`,
    removed_at: null,
  };
}

/** A GitHub that serves tenants `1..tenants`, a cache and a budget on one clock, and the cached lookups over the real ones. */
export function rolesWorld(tenants = 2) {
  const clock = new FakeClock(START);
  const fake = new FakeGitHub();
  for (let n = 1; n <= tenants; n += 1) {
    fake.addInstallation(installation(githubInstallationOf(n), `org-${n}`));
  }
  const logs = captureLogs();
  const log = createLogger({ logLevel: 'info' }, logs.destination);
  const cache = new RoleCache({ clock });
  const budget = createViewerLookupBudget(clock);
  const lookups = createRoleLookups({
    cache,
    budget,
    orgAdmin: createOrgAdminLookup({ github: fake, log }),
    repoAdmin: createRepoAdminLookup({ github: fake, log }),
  });
  /** What GitHub says of the viewer in tenant `n`: an admin of the organisation, or a plain member. */
  const setOrgRole = (n: number, role: 'admin' | 'member'): void => {
    fake.addMembership(id(githubInstallationOf(n)), `org-${n}`, 'alice', {
      state: 'active',
      role,
      userId: id(VIEWER_ID),
    });
  };
  /** What GitHub says of the viewer on repository `index` of tenant `n`. */
  const setRepoPermission = (n: number, index: number, permission: 'admin' | 'write'): void => {
    fake.addRepositoryPermission(id(githubInstallationOf(n)), `org-${n}/repo-${index}`, 'alice', {
      permission,
      userId: id(VIEWER_ID),
    });
  };
  return { clock, fake, logs, cache, budget, lookups, setOrgRole, setRepoPermission };
}
