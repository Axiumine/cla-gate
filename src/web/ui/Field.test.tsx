// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Field } from './Field.tsx';
import { RadioGroup } from './RadioGroup.tsx';
import { Select } from './Select.tsx';
import { Textarea } from './Textarea.tsx';
import { TextInput } from './TextInput.tsx';

// E17-S06: Field ties a label, a description and an error to the control inside it, whichever control that is.

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

/** Every control a field wraps, with the role it has and the element that carries the field's attributes. */
const CONTROLS: readonly (readonly [name: string, control: ReactElement, role: string])[] = [
  ['TextInput', <TextInput key="control" />, 'textbox'],
  ['Textarea', <Textarea key="control" />, 'textbox'],
  ['Select', <Select key="control" options={OPTIONS} />, 'combobox'],
  ['Checkbox', <Checkbox key="control" />, 'checkbox'],
  ['RadioGroup', <RadioGroup key="control" options={OPTIONS} />, 'radiogroup'],
];

test.each(CONTROLS)('%s is named by the label of its field', (_name, control, role) => {
  renderWithProviders(<Field label="Display name">{control}</Field>);
  expect(screen.getByRole(role, { name: 'Display name' })).toBeInTheDocument();
});

test.each(CONTROLS)('%s is described by the description and the error, in that order', (_name, control, role) => {
  renderWithProviders(
    <Field label="Display name" description="As on your invoices" error="Too long">
      {control}
    </Field>,
  );
  const element = screen.getByRole(role);
  expect(element).toHaveAccessibleDescription('As on your invoices Too long');
  expect(element).toHaveAttribute('aria-invalid', 'true');
});

test.each(CONTROLS)('%s is marked aria-required in a required field, and only then', (_name, control, role) => {
  const { rerender } = renderWithProviders(<Field label="Display name">{control}</Field>);
  expect(screen.getByRole(role)).not.toHaveAttribute('aria-required');
  expect(screen.getByRole(role)).not.toHaveAttribute('aria-invalid');
  rerender(
    <Field label="Display name" required>
      {control}
    </Field>,
  );
  expect(screen.getByRole(role)).toHaveAttribute('aria-required', 'true');
});

test('a required field shows (required) from the catalog in its label, and the control is named with it', () => {
  renderWithProviders(
    <Field label="Display name" required>
      <TextInput />
    </Field>,
  );
  expect(screen.getByText('(required)')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Display name (required)' })).toBeInTheDocument();
});

test('a field that is not required shows no (required)', () => {
  renderWithProviders(
    <Field label="Display name">
      <TextInput />
    </Field>,
  );
  expect(screen.queryByText('(required)')).not.toBeInTheDocument();
});

test('the error is in a role=alert node, and there is no alert, no description and no aria-describedby without them', () => {
  const { rerender } = renderWithProviders(
    <Field label="Display name">
      <TextInput />
    </Field>,
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  rerender(
    <Field label="Display name" error="Too long">
      <TextInput />
    </Field>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Too long');
  expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Too long');
});

test.each([
  ['an empty string', ''],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
])('%s as the error is no error', (_what, error) => {
  renderWithProviders(
    <Field label="Display name" error={error} description={error}>
      <TextInput />
    </Field>,
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
  expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
});

test('two fields never share an id, so each label names its own control', () => {
  renderWithProviders(
    <>
      <Field label="First" description="One">
        <TextInput />
      </Field>
      <Field label="Second" description="Two">
        <TextInput />
      </Field>
    </>,
  );
  const first = screen.getByRole('textbox', { name: 'First' });
  const second = screen.getByRole('textbox', { name: 'Second' });
  expect(first.id).not.toBe(second.id);
  expect(first).toHaveAccessibleDescription('One');
  expect(second).toHaveAccessibleDescription('Two');
});

test("the field's id wins over the id the control brings, because the label can only follow the field's", () => {
  renderWithProviders(
    <Field label="Display name">
      <TextInput id="mine" />
    </Field>,
  );
  const input = screen.getByRole('textbox', { name: 'Display name' });
  expect(input.id).not.toBe('mine');
});

test('the aria-describedby the control brings is kept next to the field description', () => {
  renderWithProviders(
    <>
      <p id="hint">Local hint</p>
      <Field label="Display name" description="From the field">
        <TextInput aria-describedby="hint" />
      </Field>
    </>,
  );
  expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Local hint From the field');
});

test('inline puts the control before its label in a row, the description and error under the label', () => {
  renderWithProviders(
    <Field label="Accept the terms" description="Read them first" error="Required to go on" inline>
      <Checkbox />
    </Field>,
  );
  expect(screen.getByText('Accept the terms')).toHaveClass('col-start-2', 'row-start-1');
  expect(screen.getByText('Read them first')).toHaveClass('col-start-2');
  expect(screen.getByRole('alert')).toHaveClass('col-start-2');
  expect(screen.getByRole('checkbox').parentElement).toHaveClass('col-start-1', 'row-start-1');
});

test('clicking the label focuses a text control', async () => {
  const { user } = renderWithProviders(
    <Field label="Display name">
      <TextInput />
    </Field>,
  );
  await user.click(screen.getByText('Display name'));
  expect(screen.getByRole('textbox')).toHaveFocus();
});

test('Tab visits the controls of the fields in order, Shift+Tab goes back, Escape clears nothing', async () => {
  const { user } = renderWithProviders(
    <>
      <Field label="First">
        <TextInput />
      </Field>
      <Field label="Second">
        <Textarea />
      </Field>
    </>,
  );
  await user.tab();
  expect(screen.getByRole('textbox', { name: 'First' })).toHaveFocus();
  await user.keyboard('hello{Escape}');
  expect(screen.getByRole('textbox', { name: 'First' })).toHaveValue('hello');
  await user.tab();
  expect(screen.getByRole('textbox', { name: 'Second' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('textbox', { name: 'First' })).toHaveFocus();
});

test.each(CONTROLS)(
  'a field with %s, a description, an error and a required mark passes axe',
  async (_name, control) => {
    const { container } = renderWithProviders(
      <Field label="Display name" description="As on your invoices" error="Too long" required>
        {control}
      </Field>,
    );
    await expectNoA11yViolations(container);
  },
);

test('hostile names in the label, the description and the error stay text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <Field label={name} description={name} error={name} required>
        <TextInput />
      </Field>,
    ),
  );
});
