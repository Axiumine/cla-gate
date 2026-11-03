// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PlainMessageKey } from '../i18n/index.ts';

/** One link of the main navigation: where it goes, and the catalog key of its words. */
export interface NavItem {
  readonly to: '/';
  readonly label: PlainMessageKey;
}

/**
 * The main navigation (E17-S09). E18 adds the screens of the dashboard here, one entry each, as it adds their routes; `to`
 * is typed from the route tree, so an entry for a route that does not exist does not compile.
 */
export const NAV_ITEMS: readonly NavItem[] = [{ to: '/', label: 'nav.home' }];
