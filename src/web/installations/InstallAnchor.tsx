// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';

export interface InstallAnchorProps {
  /** An address under `https://github.com/apps/` (`installLinkOf` has checked it). */
  readonly href: string;
  readonly children: ReactNode;
}

/** The link to GitHub's page that installs the App: a new tab, with no opener and no referrer. */
export function InstallAnchor({ href, children }: InstallAnchorProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}
