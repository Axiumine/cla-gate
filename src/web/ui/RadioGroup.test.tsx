// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Field } from './Field.tsx';
import { RadioGroup } from './RadioGroup.tsx';

// E17-S06: RadioGroup, on Radix's. Inside a Field (the label names the group): Field.test.tsx.

const OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'entity', label: 'Entity' },
  { value: 'retired', label: 'Retired', disabled: true },
  { value: 'other', label: 'Other' },
];

const radio = (name: string) => screen.getByRole('radio', { name });

test('one radio per option, each named by its label, none checked at first', () => {
  renderWithProviders(<RadioGroup aria-label="Kind" options={OPTIONS} />);
  expect(screen.getAllByRole('radio').map((item) => item.getAttribute('value'))).toEqual([
    'individual',
    'entity',
    'retired',
    'other',
  ]);
  expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  expect(radio('Retired')).toBeDisabled();
});

test('defaultValue checks one, and clicking a label checks its radio and reports the value', async () => {
  const onValueChange = vi.fn();
  const { user } = renderWithProviders(
    <RadioGroup aria-label="Kind" options={OPTIONS} defaultValue="individual" onValueChange={onValueChange} />,
  );
  expect(radio('Individual')).toBeChecked();
  await user.click(screen.getByText('Entity'));
  expect(radio('Entity')).toBeChecked();
  expect(radio('Individual')).not.toBeChecked();
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('entity');
});

test('a controlled group shows the value it is given', () => {
  const { rerender } = renderWithProviders(<RadioGroup aria-label="Kind" options={OPTIONS} value="entity" />);
  expect(radio('Entity')).toBeChecked();
  rerender(<RadioGroup aria-label="Kind" options={OPTIONS} value="other" />);
  expect(radio('Other')).toBeChecked();
});

test('a group that is not in a Field keeps the aria-labelledby and className it was given', () => {
  renderWithProviders(
    <>
      <p id="caption">Which kind</p>
      <RadioGroup aria-labelledby="caption" options={OPTIONS} className="gap-8" />
    </>,
  );
  expect(screen.getByRole('radiogroup', { name: 'Which kind' })).toHaveClass('gap-8', 'flex');
});

test('Tab enters the group once, on the first radio when none is checked, and leaves it by the next Tab', async () => {
  const { user } = renderWithProviders(
    <>
      <RadioGroup aria-label="Kind" options={OPTIONS} />
      <button type="button">After</button>
    </>,
  );
  await user.tab();
  expect(radio('Individual')).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(radio('Individual')).toHaveFocus();
});

test('Tab enters the group on the checked radio', async () => {
  const { user } = renderWithProviders(<RadioGroup aria-label="Kind" options={OPTIONS} defaultValue="other" />);
  await user.tab();
  expect(radio('Other')).toHaveFocus();
});

/**
 * Presses an arrow key the way a person does: down, then up once the focus has moved. Radix moves focus a tick after the
 * keydown and checks the radio it lands on only while the key is still held, so a key pressed and released at once, which
 * is what `user.keyboard('{ArrowDown}')` does, would move the focus and check nothing.
 */
async function arrowTo(user: UserEvent, key: string, name: string): Promise<void> {
  await user.keyboard(`{${key}>}`);
  await waitFor(() => {
    expect(radio(name)).toHaveFocus();
  });
  await user.keyboard(`{/${key}}`);
}

test('the arrow keys move focus and check the radio they land on, skip the disabled one, and wrap around', async () => {
  const { user } = renderWithProviders(<RadioGroup aria-label="Kind" options={OPTIONS} />);
  await user.tab();
  await arrowTo(user, 'ArrowDown', 'Entity');
  expect(radio('Entity')).toBeChecked();
  await arrowTo(user, 'ArrowRight', 'Other');
  expect(radio('Other')).toBeChecked();
  expect(radio('Entity')).not.toBeChecked();
  await arrowTo(user, 'ArrowDown', 'Individual');
  expect(radio('Individual')).toBeChecked();
  await arrowTo(user, 'ArrowUp', 'Other');
  await arrowTo(user, 'ArrowLeft', 'Entity');
  expect(radio('Entity')).toBeChecked();
});

test('Space checks the focused radio, Enter and Escape do not', async () => {
  const onValueChange = vi.fn();
  const { user } = renderWithProviders(
    <RadioGroup aria-label="Kind" options={OPTIONS} onValueChange={onValueChange} />,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  await user.keyboard('{Escape}');
  expect(onValueChange).not.toHaveBeenCalled();
  expect(radio('Individual')).not.toBeChecked();
  await user.keyboard(' ');
  expect(radio('Individual')).toBeChecked();
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('individual');
});

test('a group in a form submits the checked value under its name', async () => {
  const { user, container } = renderWithProviders(
    <form>
      <RadioGroup aria-label="Kind" name="kind" options={OPTIONS} />
    </form>,
  );
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('the form was not rendered');
  }
  await user.click(radio('Entity'));
  expect([...new FormData(form)]).toEqual([['kind', 'entity']]);
});

test('a group alone and a group in a field with an error pass axe', async () => {
  const { container } = renderWithProviders(
    <>
      <RadioGroup aria-label="Kind" options={OPTIONS} defaultValue="entity" />
      <Field label="Signer kind" required description="Who signs" error="Pick one">
        <RadioGroup options={OPTIONS} />
      </Field>
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name as a label of a radio and as the label of the field stays text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <Field label={name}>
        <RadioGroup options={[{ value: 'x', label: name }]} />
      </Field>,
    ),
  );
});
