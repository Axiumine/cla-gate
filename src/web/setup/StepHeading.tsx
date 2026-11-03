// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useEffect, useRef } from 'react';

export interface StepHeadingProps {
  /** The title of the step: text from the catalog. */
  readonly children: ReactNode;
  /** Moves focus to the heading when it appears. A step that replaces another sets it; the first step of a page load does not, so the first Tab still reaches "Skip to content". */
  readonly focus?: boolean;
}

/**
 * The `<h1>` of one step of a setup page (E19-S07). The steps replace each other without a navigation, so the shell does not
 * move focus (E17-S09); a step that follows another takes focus here, which is where a keyboard or screen reader user needs
 * to be: at the start of what is new. `tabindex="-1"` lets a script focus the heading and puts nothing in the tab order.
 */
export function StepHeading({ children, focus = false }: StepHeadingProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) {
      heading.current?.focus();
    }
  }, [focus]);
  return (
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
      {children}
    </h1>
  );
}
