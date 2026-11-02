// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Tabs } from './Tabs.tsx';

// E17-S06: Tabs, on Radix's.

const ITEMS = [
  { value: 'documents', label: 'Documents', panel: <p>The documents</p> },
  { value: 'signers', label: 'Signers', panel: <p>The signers</p> },
  { value: 'audit', label: 'Audit', panel: <button type="button">Export</button> },
];

const tab = (name: string) => screen.getByRole('tab', { name });

test('the tab list is named, each tab is a tab, and the first one is open with its own panel', () => {
  renderWithProviders(<Tabs label="Repository" items={ITEMS} />);
  expect(screen.getByRole('tablist', { name: 'Repository' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual(['Documents', 'Signers', 'Audit']);
  expect(tab('Documents')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Signers')).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByRole('tabpanel', { name: 'Documents' })).toHaveTextContent('The documents');
  expect(screen.queryByText('The signers')).not.toBeInTheDocument();
});

test('defaultValue opens another tab, and a tab list with no tab renders nothing to open', () => {
  const { rerender } = renderWithProviders(<Tabs label="Repository" items={ITEMS} defaultValue="audit" />);
  expect(tab('Audit')).toHaveAttribute('aria-selected', 'true');
  rerender(<Tabs label="Repository" items={[]} />);
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

test('a click opens a tab, shows its panel and reports its value', async () => {
  const onValueChange = vi.fn();
  const { user } = renderWithProviders(<Tabs label="Repository" items={ITEMS} onValueChange={onValueChange} />);
  await user.click(tab('Signers'));
  expect(tab('Signers')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('The signers')).toBeInTheDocument();
  expect(screen.queryByText('The documents')).not.toBeInTheDocument();
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('signers');
});

test('a controlled Tabs shows the value it is given', () => {
  const { rerender } = renderWithProviders(<Tabs label="Repository" items={ITEMS} value="signers" />);
  expect(tab('Signers')).toHaveAttribute('aria-selected', 'true');
  rerender(<Tabs label="Repository" items={ITEMS} value="audit" />);
  expect(tab('Audit')).toHaveAttribute('aria-selected', 'true');
});

test('Tab enters the list on the open tab, then the open panel and what is in it, and Shift+Tab goes back', async () => {
  const { user } = renderWithProviders(
    <>
      <Tabs label="Repository" items={ITEMS} defaultValue="audit" />
      <button type="button">After</button>
    </>,
  );
  await user.tab();
  expect(tab('Audit')).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('tabpanel', { name: 'Audit' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Export' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  expect(tab('Audit')).toHaveFocus();
});

test('the arrow keys move focus to the next and previous tab and open it, wrapping at the ends', async () => {
  const { user } = renderWithProviders(<Tabs label="Repository" items={ITEMS} />);
  await user.tab();
  await user.keyboard('{ArrowRight}');
  expect(tab('Signers')).toHaveFocus();
  expect(tab('Signers')).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowRight}');
  await user.keyboard('{ArrowRight}');
  expect(tab('Documents')).toHaveFocus();
  expect(screen.getByText('The documents')).toBeInTheDocument();
  await user.keyboard('{ArrowLeft}');
  expect(tab('Audit')).toHaveFocus();
  expect(tab('Audit')).toHaveAttribute('aria-selected', 'true');
});

test('Home and End go to the first and last tab', async () => {
  const { user } = renderWithProviders(<Tabs label="Repository" items={ITEMS} />);
  await user.tab();
  await user.keyboard('{End}');
  expect(tab('Audit')).toHaveFocus();
  await user.keyboard('{Home}');
  expect(tab('Documents')).toHaveFocus();
});

test('Enter and Space on the open tab keep it open, and Escape changes nothing', async () => {
  const onValueChange = vi.fn();
  const { user } = renderWithProviders(<Tabs label="Repository" items={ITEMS} onValueChange={onValueChange} />);
  await user.tab();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  await user.keyboard('{Escape}');
  expect(tab('Documents')).toHaveFocus();
  expect(tab('Documents')).toHaveAttribute('aria-selected', 'true');
  expect(onValueChange).not.toHaveBeenCalled();
});

test('the tabs pass axe, with the first panel and with another one open', async () => {
  const { container, rerender } = renderWithProviders(<Tabs label="Repository" items={ITEMS} />);
  await expectNoA11yViolations(container);
  rerender(<Tabs label="Repository" items={ITEMS} value="audit" />);
  await expectNoA11yViolations(container);
});

test('a hostile name in a tab and in its panel stays text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(<Tabs label="Repository" items={[{ value: 'x', label: name, panel: <p>{name}</p> }]} />),
  );
});
