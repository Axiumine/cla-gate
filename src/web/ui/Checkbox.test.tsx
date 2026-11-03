// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Field } from './Field.tsx';

// E17-S06: Checkbox, on Radix's. Inside a Field (name, description, error, required): Field.test.tsx.

test('a checkbox is unchecked by default, checked by defaultChecked, and aria-checked says which', () => {
  renderWithProviders(
    <>
      <Checkbox aria-label="Off" />
      <Checkbox aria-label="On" defaultChecked />
    </>,
  );
  expect(screen.getByRole('checkbox', { name: 'Off' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'On' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'On' })).toHaveAttribute('data-state', 'checked');
});

test('a click toggles it and reports a boolean, never the indeterminate state of the library', async () => {
  const onCheckedChange = vi.fn<(checked: boolean) => void>();
  const { user } = renderWithProviders(<Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('checkbox'));
  expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
});

test('a toggle without onCheckedChange works', async () => {
  const { user } = renderWithProviders(<Checkbox aria-label="Agree" />);
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
});

test('a controlled checkbox shows what it is given and follows the change', async () => {
  const { user, rerender } = renderWithProviders(<Checkbox aria-label="Agree" checked={false} />);
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  rerender(<Checkbox aria-label="Agree" checked />);
  expect(screen.getByRole('checkbox')).toBeChecked();
});

test('the label of a Field toggles it, and clicking the label of an inline field does the same', async () => {
  const { user } = renderWithProviders(
    <Field label="Accept the terms" inline>
      <Checkbox />
    </Field>,
  );
  await user.click(screen.getByText('Accept the terms'));
  expect(screen.getByRole('checkbox', { name: 'Accept the terms' })).toBeChecked();
});

test('Tab focuses it, Space toggles it, Enter and Escape do not, and a disabled checkbox is skipped', async () => {
  const onCheckedChange = vi.fn<(checked: boolean) => void>();
  const { user } = renderWithProviders(
    <>
      <Checkbox aria-label="Off" disabled />
      <Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />
    </>,
  );
  await user.tab();
  expect(screen.getByRole('checkbox', { name: 'Agree' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard('{Escape}');
  expect(onCheckedChange).not.toHaveBeenCalled();
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: 'Agree' })).toBeChecked();
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: 'Agree' })).not.toBeChecked();
});

test('it submits with its form: the name and value reach the form data only when it is checked', async () => {
  const { user, container } = renderWithProviders(
    <form>
      <Checkbox aria-label="Agree" name="agree" value="yes" />
    </form>,
  );
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('the form was not rendered');
  }
  const data = () => [...new FormData(form)];
  expect(data()).toEqual([]);
  await user.click(screen.getByRole('checkbox'));
  expect(data()).toEqual([['agree', 'yes']]);
});

test('checked and unchecked checkboxes, alone and in a field, pass axe', async () => {
  const { container } = renderWithProviders(
    <>
      <Checkbox aria-label="Off" />
      <Checkbox aria-label="On" defaultChecked />
      <Field label="Accept the terms" required inline description="Read them first" error="Required to go on">
        <Checkbox />
      </Field>
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name as the label of a field stays text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <Field label={name} inline>
        <Checkbox />
      </Field>,
    ),
  );
});
