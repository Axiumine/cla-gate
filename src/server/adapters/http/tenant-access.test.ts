// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import type { Requirement } from '../../domain/authz.ts';
import type { InstallationRowId } from '../db/installation-row-id.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import {
  requireTenant,
  type TenantContext,
  type TenantRole,
  type TenantTarget,
  tenantAccess,
} from './tenant-access.ts';
import { guardWorld } from './tenant-guard-fixture/test-support.ts';

// What a tenant route declares and what its handler reads (E11-S05).

test('tenantAccess is the declaration of a tenant route: its kind, its mode and its resolver as they were given', () => {
  const resolve = () => Promise.resolve(null);
  expect(tenantAccess({ mode: 'read', resolve })).toEqual({ kind: 'tenant', mode: 'read', resolve });
  expect(tenantAccess({ mode: 'write', resolve }).resolve).toBe(resolve);
  expect(tenantAccess({ mode: 'write', resolve }).mode).toBe('write');
});

test('a route that is not a tenant route sees no tenant, and requireTenant refuses it as a defect of the route', async () => {
  const { app, login } = await authWorld();
  const seen: unknown[] = [];
  app.get('/t/not-tenant', { config: { access: 'authenticated' } }, (request) => {
    seen.push(request.tenant);
    return requireTenant(request);
  });
  const alice = await login(1001);
  const response = await app.inject({ url: '/t/not-tenant', headers: { cookie: alice.cookie } });
  expect(seen).toEqual([null]);
  expect(response.statusCode).toBe(500);
});

test('a tenant route hands its handler the installation, the repository and the role, and requireTenant returns them', async () => {
  const world = await guardWorld();
  const answer = await world.ask('GET', `/t/repositories/${world.repositories.t1r1}`, 'repoAdmin1');
  expect(answer.json()).toEqual({
    tenant: { installationId: world.tenants.t1, repositoryId: world.repositories.t1r1, role: 'repo_admin' },
  });
});

test('the role of a tenant is a requirement of the decision table, and a repo_admin target cannot be written with no repository', () => {
  expectTypeOf<TenantRole>().toEqualTypeOf<Requirement>();
  expectTypeOf<TenantContext['repositoryId']>().toEqualTypeOf<number | null>();
  interface Target {
    installationId: InstallationRowId;
    repositoryId: number | null;
    requirement: Requirement;
  }
  expectTypeOf<Target & { repositoryId: null; requirement: 'repo_admin' }>().not.toExtend<TenantTarget>();
  expectTypeOf<Target & { repositoryId: null; requirement: 'org_admin' }>().toExtend<TenantTarget>();
  expectTypeOf<Target & { repositoryId: number; requirement: 'repo_admin' }>().toExtend<TenantTarget>();
});
