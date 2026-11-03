// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { Heading, type HeadingLevel } from '../ui/Heading.tsx';

export interface EmptyStateProps {
  /** The heading level that fits the outline of the page this sits in. */
  readonly level: HeadingLevel;
  readonly title: string;
  readonly description: string;
  /** The one thing to do about it, a primary `Button` or a link: absent when there is nothing to do. */
  readonly action?: ReactNode;
}

/** A request that succeeded and found nothing (E17-S07): what is missing, why it matters, and what to do next. */
export function EmptyState({ level, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-8 text-center">
      <Heading level={level}>{title}</Heading>
      <p className="text-fg-muted">{description}</p>
      {action}
    </div>
  );
}
