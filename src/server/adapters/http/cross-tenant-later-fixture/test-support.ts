// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { OWN_SIGNATURES_PATH } from '../../../../shared/own-signatures.ts';
import {
  CORPORATE_CROSS_CASES,
  CORPORATE_ISOLATION_CASES,
  CORPORATE_NO_TENANT_DATA,
} from '../cross-tenant-corporate-fixture/test-support.ts';
import type { CrossTenantCase, IsolationCase } from '../cross-tenant-fixture/test-support.ts';
import { OWN_SIGNATURES_CASE } from '../cross-tenant-own-signatures-fixture/test-support.ts';
import { REVOCATION_CASES } from '../cross-tenant-revocation-fixture/test-support.ts';

// The cases the stories after the first of the matrix (E11-S06) added, collected in one place: the fixture of the matrix is at its size
// cap, so it spreads these three tables instead of importing each story's file. A story that adds a route adds its file's tables here
// (E15: the revocation; E13-S06: the own signatures; E21-S02: corporate signing).

/** The `tenant` routes of E15 and E21. */
export const LATER_CROSS: Readonly<Record<string, CrossTenantCase>> = { ...REVOCATION_CASES, ...CORPORATE_CROSS_CASES };

/** The `authenticated` routes that return tenant data, of E13-S06 and E21. */
export const LATER_ISOLATION: Readonly<Record<string, IsolationCase>> = {
  [`GET ${OWN_SIGNATURES_PATH}`]: OWN_SIGNATURES_CASE,
  ...CORPORATE_ISOLATION_CASES,
};

/** The `authenticated` routes of E21 that return no tenant data, or that the matrix cannot ask twice. */
export const LATER_NO_DATA: Readonly<Record<string, string>> = CORPORATE_NO_TENANT_DATA;
