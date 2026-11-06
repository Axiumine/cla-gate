// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PlainMessageKey } from '../i18n/index.ts';
import { withAccess } from '../route-access.ts';
import { TenantSwitcher } from './TenantSwitcher.tsx';

/** The one element every screen below an installation hands the shell for its header (made once, as `headerSlot` asks). */
const SWITCHER = <TenantSwitcher />;

/**
 * The route options of a screen below an installation (E18-S04), to be spread into `createRoute`: it needs a login (every
 * maintainer screen does) and puts the tenant switcher in the header of the shell. The tenant is the one in the address; the
 * server decides on each request whether the person may see it.
 */
export function tenantPage(title: PlainMessageKey) {
  return withAccess('authenticated', { title, headerSlot: SWITCHER });
}
