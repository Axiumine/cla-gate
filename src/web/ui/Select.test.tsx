// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Field } from './Field.tsx';
import { Select } from './Select.tsx';

// E17-S06: Select, the native <select> in the look of the text controls. Inside a Field: Field.test.tsx.

const OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'entity', label: 'Entity' },
  { value: 'retired', label: 'Retired', disabled: true },
];

test('a Select shows one option per entry, with its value, its text and its disabled state', () => {
  renderWithProviders(<Select aria-label="Kind" options={OPTIONS} />);
  const options = screen.getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual(['Individual', 'Entity', 'Retired']);
  expect(options.map((option) => option.getAttribute('value'))).toEqual(['individual', 'entity', 'retired']);
  expect(options.map((option) => option.hasAttribute('disabled'))).toEqual([false, false, true]);
});

test('choosing an option calls onChange with its value', async () => {
  const onChange = vi.fn();
  const { user } = renderWithProviders(<Select aria-label="Kind" options={OPTIONS} onChange={onChange} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'entity');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveValue('entity');
});

test('a Select that is not wrapped in a Field keeps the id and the aria attributes it was given', () => {
  renderWithProviders(
    <Select id="mine" aria-label="Kind" aria-invalid="true" options={OPTIONS} className="max-w-xs" />,
  );
  const select = screen.getByRole('combobox', { name: 'Kind' });
  expect(select).toHaveAttribute('id', 'mine');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(select).toHaveClass('max-w-xs', 'border-line');
});

test('Tab focuses it, Enter, Space and Escape change nothing, and a disabled Select is skipped', async () => {
  const onChange = vi.fn();
  const { user } = renderWithProviders(
    <>
      <Select aria-label="Off" options={OPTIONS} disabled />
      <Select aria-label="Kind" options={OPTIONS} onChange={onChange} />
    </>,
  );
  await user.tab();
  expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  await user.keyboard('{Escape}');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveValue('individual');
});

test('a Select and a Field of it pass axe', async () => {
  const { container } = renderWithProviders(
    <>
      <Select aria-label="Kind" options={OPTIONS} />
      <Field label="Document kind" description="Which agreement" error="Pick one">
        <Select options={OPTIONS} />
      </Field>
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name as the text of an option is the text of the option', () => {
  for (const name of HOSTILE_NAMES) {
    const { container, unmount } = renderWithProviders(
      <Select aria-label="Kind" options={[{ value: 'x', label: name }]} />,
    );
    expect(screen.getByRole('option').textContent).toBe(name);
    expect(container.querySelectorAll('script, img, a')).toHaveLength(0);
    unmount();
  }
});

test('hostile names in the label and the options of a Field stay text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <Field label={name}>
        <Select options={[{ value: 'x', label: name }]} />
      </Field>,
    ),
  );
});
