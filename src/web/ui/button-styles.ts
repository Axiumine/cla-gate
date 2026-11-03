// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** Each variant over the tokens of E17-S05: the label and fill pairs are the ones `contrast.test.ts` checks in both themes. */
export const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-muted',
  danger: 'bg-danger text-on-danger hover:bg-danger-hover',
  ghost: 'bg-transparent text-fg hover:bg-surface-muted',
};

export const BASE_CLASSES =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium aria-busy:cursor-progress disabled:cursor-not-allowed disabled:opacity-60';
