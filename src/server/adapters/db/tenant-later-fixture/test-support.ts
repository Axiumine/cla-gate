// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { E21_CLAIM_TENANT_MODULES, E21_CLAIM_TENANT_QUERIES } from '../tenant-corporate-claim-fixture/test-support.ts';
import { E21_TENANT_MODULES, E21_TENANT_QUERIES } from '../tenant-corporate-fixture/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';
import { E15_TENANT_MODULES, E15_TENANT_QUERIES } from '../tenant-revocation-fixture/test-support.ts';

// The registry (tenant-registry/test-support.ts) is at its size cap, so the modules and the entries of the epics that came after the
// sign context (E15, E21) reach it through this one file: the registry spreads these two values and each epic adds its own list here.

/** The files of the later epics that run a statement over a tenant table. */
export const LATER_TENANT_MODULES = [
  ...E15_TENANT_MODULES,
  ...E21_TENANT_MODULES,
  ...E21_CLAIM_TENANT_MODULES,
] as const;

/** Every function of those files, by module and name. */
export const LATER_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  ...E15_TENANT_QUERIES,
  ...E21_TENANT_QUERIES,
  ...E21_CLAIM_TENANT_QUERIES,
};
