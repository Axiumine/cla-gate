// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface TabItem {
  readonly value: string;
  /** The text of the tab: from the catalog, or user text through `UserText`. */
  readonly label: ReactNode;
  /** What the tab shows. Only the selected panel is in the document. */
  readonly panel: ReactNode;
}

type RootProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

export type TabsProps = Omit<RootProps, 'children' | 'orientation' | 'dir'> & {
  readonly items: readonly TabItem[];
  /** The accessible name of the tab list: what the set of tabs is about. */
  readonly label: string;
};

const TRIGGER_CLASSES =
  '-mb-px cursor-pointer border-b-2 border-transparent px-4 py-2 text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-fg';

/**
 * Tabs on Radix's (E17-S06): one tab stop for the list, arrow keys (and Home and End) move between tabs and select them,
 * and Tab goes on into the open panel. The first tab is open unless `value` or `defaultValue` says otherwise.
 */
export function Tabs({ items, label, defaultValue, ...props }: TabsProps) {
  return (
    <TabsPrimitive.Root {...props} defaultValue={defaultValue ?? items[0]?.value}>
      <TabsPrimitive.List aria-label={label} className="flex border-b border-line">
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.value} value={item.value} className={TRIGGER_CLASSES}>
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="py-4">
          {item.panel}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
