// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Button } from '../ui/Button.tsx';
import type { HeadingLevel } from '../ui/Heading.tsx';
import { EmptyState } from './EmptyState.tsx';

// E17-S07: EmptyState. A heading of the level the caller chose, a title, a description and an optional primary action.

const LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];

test.each(LEVELS)('the title is a level-%i heading when the caller asks for level %i', (level) => {
  renderWithProviders(<EmptyState level={level} title="No repositories" description="Install the app first." />);
  expect(screen.getByRole('heading', { level, name: 'No repositories' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
});

test('the description is shown as text under the title', () => {
  renderWithProviders(<EmptyState level={2} title="No repositories" description="Install the app first." />);
  expect(screen.getByText('Install the app first.')).toBeInTheDocument();
});

test('without an action there is nothing to press', () => {
  renderWithProviders(<EmptyState level={2} title="No repositories" description="Install the app first." />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

test('the primary action is shown and works with the mouse, Enter and Space', async () => {
  const onClick = vi.fn();
  const { user } = renderWithProviders(
    <EmptyState
      level={2}
      title="No repositories"
      description="Install the app first."
      action={
        <Button variant="primary" onClick={onClick}>
          Install the app
        </Button>
      }
    />,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Install the app' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  await user.click(screen.getByRole('button', { name: 'Install the app' }));
  expect(onClick).toHaveBeenCalledTimes(3);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Install the app' })).toHaveFocus();
});

test('with and without an action it passes axe', async () => {
  const { container } = renderWithProviders(
    <>
      <EmptyState level={2} title="No repositories" description="Install the app first." />
      <EmptyState
        level={3}
        title="No signers"
        description="Nobody has signed yet."
        action={<Button variant="primary">Share the link</Button>}
      />
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name in the title or the description stays text', () => {
  expectHostileNamesInert((name) => renderWithProviders(<EmptyState level={2} title={name} description={name} />));
});
