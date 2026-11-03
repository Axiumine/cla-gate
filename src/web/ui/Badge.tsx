// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { BADGE_VARIANTS, type BadgeStatus, type BadgeVariant } from './badge-status.ts';
import { classNames } from './class-names.ts';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-surface-muted text-fg',
};

export interface BadgeProps {
  readonly status: BadgeStatus;
  /** Replaces the label of the status (the catalog's `status.<name>`), for a screen that has a more exact word. */
  readonly children?: ReactNode;
}

/**
 * A short status in words (E17-S06). The label is always text, from the catalog unless the screen gives its own, so colour is
 * never the only signal: the tint repeats what the word says. The transparent border shows in forced-colors mode, where fills go.
 */
export function Badge({ status, children }: BadgeProps) {
  const t = useT();
  // eslint-disable-next-line security/detect-object-injection -- status is the closed BadgeStatus union, never user input
  const tint = VARIANT_CLASSES[BADGE_VARIANTS[status]];
  return (
    <span
      data-status={status}
      className={classNames(
        'inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
        tint,
      )}
    >
      {children ?? t(`status.${status}`)}
    </span>
  );
}
