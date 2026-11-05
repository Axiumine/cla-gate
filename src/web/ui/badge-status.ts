// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** How a badge looks; each variant is a pair of tokens that `contrast.test.ts` checks in both themes. */
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * The statuses a screen shows as a badge (E17-S06), each with the catalog label `status.<name>`. A screen that needs a new one
 * adds it here, to `BADGE_VARIANTS` and to the catalog: leaving out the variant fails `tsc`, leaving out the label does too.
 */
export const BADGE_STATUSES = [
  'active',
  'cancelled',
  'disabled',
  'draft',
  'enabled',
  'failed',
  'org_admin',
  'outdated',
  'passed',
  'pending',
  'repo_admin',
  'revoked',
  'suspended',
] as const;

export type BadgeStatus = (typeof BADGE_STATUSES)[number];

/** The variant of every status. A record over the union, so an unmapped status is a type error. */
export const BADGE_VARIANTS: Record<BadgeStatus, BadgeVariant> = {
  active: 'success',
  cancelled: 'neutral',
  disabled: 'neutral',
  draft: 'info',
  enabled: 'success',
  failed: 'danger',
  org_admin: 'info',
  outdated: 'warning',
  passed: 'success',
  pending: 'info',
  repo_admin: 'neutral',
  revoked: 'danger',
  suspended: 'warning',
};
