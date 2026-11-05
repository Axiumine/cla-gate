// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingPrsPage } from '../../../shared/pending-prs.ts';
import type { PendingPage } from '../../services/pending-prs.ts';
import { pendingCursor } from './pending-prs-cursor.ts';

// The pending pull requests as `GET …/pending-prs` sends them (E15-S07): the instant of an evaluation as ISO 8601, the logins exactly as
// stored, and the opaque cursor that stands for the row the next page starts at.

/** A page as `pendingPrsPageSchema` has it. */
export function presentPendingPage(page: PendingPage): PendingPrsPage {
  return {
    items: page.items.map((item) => ({
      ...item,
      evaluatedAt: item.evaluatedAt.toISOString(),
      reasons: [...item.reasons],
    })),
    nextCursor: page.next === null ? null : pendingCursor(page.next),
    truncated: page.truncated,
  };
}
