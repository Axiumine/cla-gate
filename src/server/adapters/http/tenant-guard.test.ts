// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  type GuardWorld,
  guardWorld,
  type Person,
  ROLE_READS,
  tenantTables,
} from './tenant-guard-fixture/test-support.ts';

// The denial table of E11-S05 for one GET and one POST, through the real application: an org admin, an admin of the target
// repository, an admin of another repository, an org member who is no admin, an outsider, and the admin of another tenant.

type Scope = 'installation' | 'repository';
type Role = 'org_admin' | 'repo_admin';

interface Row {
  readonly scope: Scope;
  readonly person: Person;
  readonly status: 200 | 403 | 404;
  /** The role the handler sees in `request.tenant`, for an allowed call. */
  readonly role?: Role;
}

/** The installation routes need an org admin; the repository routes (repository 1 of tenant 1) a repository admin, an org admin included. */
const ROWS: readonly Row[] = [
  { scope: 'installation', person: 'admin1', status: 200, role: 'org_admin' },
  { scope: 'installation', person: 'repoAdmin1', status: 403 },
  { scope: 'installation', person: 'repoAdminOther', status: 403 },
  { scope: 'installation', person: 'member1', status: 404 },
  { scope: 'installation', person: 'outsider', status: 404 },
  { scope: 'installation', person: 'admin2', status: 404 },
  { scope: 'repository', person: 'admin1', status: 200, role: 'org_admin' },
  { scope: 'repository', person: 'repoAdmin1', status: 200, role: 'repo_admin' },
  { scope: 'repository', person: 'repoAdminOther', status: 403 },
  { scope: 'repository', person: 'member1', status: 404 },
  { scope: 'repository', person: 'outsider', status: 404 },
  { scope: 'repository', person: 'admin2', status: 404 },
];

const CASES = (['GET', 'POST'] as const).flatMap((method) => ROWS.map((row) => ({ method, ...row })));

function urlOf(world: GuardWorld, scope: Scope): string {
  return scope === 'installation'
    ? `/t/installations/${world.tenants.t1}`
    : `/t/repositories/${world.repositories.t1r1}`;
}

test.each(CASES)('$method on a $scope route answers $status to $person', async (row) => {
  const world = await guardWorld();
  const before = await tenantTables(world.db);
  const response = await world.ask(row.method, urlOf(world, row.scope), row.person);
  expect(response.statusCode).toBe(row.status);
  if (row.status === 200) {
    expect(response.json()).toEqual({
      tenant: {
        installationId: world.tenants.t1,
        repositoryId: row.scope === 'repository' ? world.repositories.t1r1 : null,
        role: row.role,
      },
    });
    expect(world.reached).toHaveLength(1);
    return;
  }
  // The body is the standard one and nothing else: it never says what role the viewer holds, or that there is one.
  const code = row.status === 403 ? 'forbidden' : 'not_found';
  const message = row.status === 403 ? 'Forbidden' : 'Not Found';
  expect(response.json()).toEqual({ error: { code, message, requestId: response.headers['x-request-id'] } });
  // The handler never ran, no tenant row changed, and the only calls made to GitHub were reads of a role.
  expect(world.reached).toEqual([]);
  expect(await tenantTables(world.db)).toBe(before);
  expect(world.fake.calls.map((call) => call.method).filter((method) => !ROLE_READS.includes(method))).toEqual([]);
});
