// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode, Ref } from 'react';

/** The levels HTML has. The caller picks the one that fits the outline of its page: a state inside a section is not an `h1`. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const TAGS = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const satisfies Record<HeadingLevel, string>;

const SIZES: Record<HeadingLevel, string> = {
  1: 'text-2xl font-semibold',
  2: 'text-xl font-semibold',
  3: 'text-lg font-semibold',
  4: 'text-base font-semibold',
  5: 'text-sm font-semibold',
  6: 'text-xs font-semibold',
};

export interface HeadingProps {
  readonly level: HeadingLevel;
  /** The title: text from the catalog, or through `UserText` when it holds user text. */
  readonly children: ReactNode;
  /** The element, for a script that moves focus to the heading of a result that replaced a form (E18-S01). */
  readonly ref?: Ref<HTMLHeadingElement>;
  /** `tabindex="-1"`: a script can focus the heading, and it stays out of the tab order. */
  readonly focusable?: boolean;
}

/**
 * A heading whose level is chosen by the caller (E17-S07), so a component that shows a title (an empty state, an error)
 * fits the outline of the page it sits in. The look follows the level; the level is what assistive technology reads.
 */
export function Heading({ level, children, ref, focusable = false }: HeadingProps) {
  // eslint-disable-next-line security/detect-object-injection -- level is the closed HeadingLevel union, never user input
  const Tag = TAGS[level];
  // eslint-disable-next-line security/detect-object-injection -- level is the closed HeadingLevel union, never user input
  const size = SIZES[level];
  return (
    <Tag ref={ref} tabIndex={focusable ? -1 : undefined} className={size}>
      {children}
    </Tag>
  );
}
