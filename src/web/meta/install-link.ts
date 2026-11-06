// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { MetaResponse } from '../../shared/meta.ts';

// Where a person installs the GitHub App (E18-S04), as the instance says it in `GET /api/meta` (E17-S09).

/** Where an App is installed from: the page of the App on GitHub, under this prefix and no other. */
const INSTALL_URL_PREFIX = 'https://github.com/apps/';

/**
 * What the instance offers for installing the App: `link` with the address when it names one on GitHub's `apps/` path, `setup`
 * when it says there is none (`installUrl: null`, the App is not set up yet), and `unknown` while the answer is not there, when
 * it could not be read, and for an address that is not under {@link INSTALL_URL_PREFIX}: no link is made of it.
 */
export type InstallLink =
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'setup' }
  | { readonly kind: 'unknown' };

/** The install link for an answer of `GET /api/meta`, or for none yet (`undefined`). */
export function installLinkOf(meta: Pick<MetaResponse, 'installUrl'> | undefined): InstallLink {
  if (meta === undefined) {
    return { kind: 'unknown' };
  }
  if (meta.installUrl === null) {
    return { kind: 'setup' };
  }
  return meta.installUrl.startsWith(INSTALL_URL_PREFIX) ? { kind: 'link', href: meta.installUrl } : { kind: 'unknown' };
}
