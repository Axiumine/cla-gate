// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';

/** How a state looks: the colours are the tokens of the theme, so every pairing is one that the contrast tests check. */
const TONES = {
  neutral: 'border-line bg-surface text-fg',
  info: 'border-transparent bg-info-bg text-info-fg',
  success: 'border-transparent bg-success-bg text-success-fg',
  warning: 'border-transparent bg-warning-bg text-warning-fg',
} as const;

type PanelTone = keyof typeof TONES;

export interface StatePanelProps {
  readonly tone: PanelTone;
  readonly children: ReactNode;
}

/**
 * A state of the sign page that tells the person something and offers a next step (E18-S02): a live region with the role
 * `status`, because it informs and nothing failed. A failure is an `ErrorState`, whose role is `alert`.
 */
export function StatePanel({ tone, children }: StatePanelProps) {
  // eslint-disable-next-line security/detect-object-injection -- tone is the closed PanelTone union, never user input
  const look = TONES[tone];
  return (
    <section role="status" className={`flex flex-col items-start gap-3 rounded-lg border p-4 ${look}`}>
      {children}
    </section>
  );
}
