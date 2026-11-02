// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Badge } from './Badge.tsx';
import { BADGE_STATUSES, BADGE_VARIANTS, type BadgeStatus, type BadgeVariant } from './badge-status.ts';

// E17-S06: Badge. The label is always text; the colour only repeats it; the mapping of statuses to variants is a typed record.

const STATUSES = BADGE_STATUSES;
const compare = (a: string, b: string): number => a.localeCompare(b);

const TINTS: Record<BadgeVariant, string> = {
  success: 'bg-success-bg',
  warning: 'bg-warning-bg',
  danger: 'bg-danger-bg',
  info: 'bg-info-bg',
  neutral: 'bg-surface-muted',
};

test.each(STATUSES)('the %s badge carries its catalog label as text and the tint of its variant', (status) => {
  renderWithProviders(<Badge status={status} />);
  const badge = screen.getByText(messages[`status.${status}`]);
  expect(badge).toHaveAttribute('data-status', status);
  // eslint-disable-next-line security/detect-object-injection -- status is the closed BadgeStatus union, never user input
  expect(badge).toHaveClass(TINTS[BADGE_VARIANTS[status]]);
});

test('every status is mapped to a variant that has a tint, and every status has a label in the catalog', () => {
  expect(Object.keys(BADGE_VARIANTS).toSorted(compare)).toEqual([...STATUSES].toSorted(compare));
  for (const status of STATUSES) {
    // eslint-disable-next-line security/detect-object-injection -- status is the closed BadgeStatus union, never user input
    expect(Object.keys(TINTS)).toContain(BADGE_VARIANTS[status]);
    expect(messages[`status.${status}`].length).toBeGreaterThan(0);
  }
});

test('a badge shows a word, never a colour alone: no status has an empty label', () => {
  const { container } = renderWithProviders(
    <div>
      {STATUSES.map((status) => (
        <Badge key={status} status={status} />
      ))}
    </div>,
  );
  for (const badge of container.querySelectorAll('[data-status]')) {
    expect(badge.textContent.trim()).not.toBe('');
  }
});

test('a screen can give the badge a more exact word, and the status still sets the tint', () => {
  renderWithProviders(<Badge status="pending">Org admin</Badge>);
  expect(screen.getByText('Org admin')).toHaveClass('bg-info-bg');
  expect(screen.queryByText('Pending')).not.toBeInTheDocument();
});

test('an unmapped status is a type error', () => {
  // @ts-expect-error -- the point of the test: a status that BADGE_VARIANTS does not map must not compile (E17-S06)
  const unmapped: BadgeStatus = 'on_fire';
  expect(unmapped in BADGE_VARIANTS).toBe(false);
});

test('a badge is not interactive: Tab passes over it to the next control', async () => {
  const { user } = renderWithProviders(
    <>
      <Badge status="active" />
      <button type="button">Next</button>
    </>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  await user.keyboard('{Enter}{Escape} ');
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
});

test('every badge passes axe', async () => {
  const { container } = renderWithProviders(
    <div>
      {STATUSES.map((status) => (
        <Badge key={status} status={status} />
      ))}
    </div>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name as the label stays text', () => {
  expectHostileNamesInert((name) => renderWithProviders(<Badge status="pending">{name}</Badge>));
});
