// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { BASE_CLASSES, VARIANT_CLASSES } from '../ui/button-styles.ts';
import { loginStartUrl } from './return-to.ts';

export interface LoginLinkProps {
  /** Where the login ends: a path of this site, checked by `buildReturnTo`. Without it the person lands on the front page. */
  readonly returnTo?: string | undefined;
  /** `button` looks like the primary button; `text` is a link inside a sentence or a banner. */
  readonly look?: 'button' | 'text';
  /** The words, from the catalog. */
  readonly children: ReactNode;
}

/**
 * The link that starts the login (E17-S08). It is a plain `<a>`, so the browser loads the login start as a page and follows
 * its redirect to GitHub; client routing could not. The start only reads (it writes nothing), so a GET link is enough.
 */
export function LoginLink({ returnTo, look = 'button', children }: LoginLinkProps) {
  const classes = look === 'button' ? `${BASE_CLASSES} ${VARIANT_CLASSES.primary}` : 'underline underline-offset-2';
  return (
    <a href={loginStartUrl(returnTo)} className={classes}>
      {children}
    </a>
  );
}
