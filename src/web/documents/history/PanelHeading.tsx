// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useEffect, useRef } from 'react';
import { Heading } from '../../ui/index.ts';

/**
 * The heading of a panel that the person opened (E18-S11): it takes focus when it appears, so a keyboard or screen-reader user is
 * taken to what they asked for, and it stays out of the tab order afterwards.
 */
export function PanelHeading({ children }: { readonly children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <Heading level={3} ref={heading} focusable>
      {children}
    </Heading>
  );
}
