// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Field } from './Field.tsx';
import { Textarea } from './Textarea.tsx';
import { TextInput, type TextInputType } from './TextInput.tsx';

// E17-S06: TextInput and Textarea, on their own (outside a Field) and with the keyboard. Inside a Field: Field.test.tsx.

const TYPES: readonly TextInputType[] = ['text', 'email', 'search', 'url', 'tel', 'password'];

test.each(TYPES)('a TextInput of type %s has that type', (type) => {
  renderWithProviders(<TextInput type={type} aria-label="Value" />);
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', type);
});

test('a TextInput is a text input unless it says otherwise', () => {
  renderWithProviders(<TextInput aria-label="Value" />);
  expect(screen.getByRole('textbox', { name: 'Value' })).toHaveAttribute('type', 'text');
});

test('a TextInput that is not wrapped in a Field keeps the id and the aria attributes it was given', () => {
  renderWithProviders(
    <TextInput id="mine" aria-label="Value" aria-invalid="true" aria-required="true" aria-describedby="hint" />,
  );
  const input = screen.getByRole('textbox', { name: 'Value' });
  expect(input).toHaveAttribute('id', 'mine');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-required', 'true');
  expect(input).toHaveAttribute('aria-describedby', 'hint');
});

test('a Textarea has four rows unless it says otherwise, and keeps what it was given', () => {
  const { rerender } = renderWithProviders(<Textarea aria-label="Notes" id="notes" />);
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('rows', '4');
  expect(screen.getByRole('textbox')).toHaveAttribute('id', 'notes');
  rerender(<Textarea aria-label="Notes" rows={8} className="font-code" />);
  expect(screen.getByRole('textbox')).toHaveAttribute('rows', '8');
  expect(screen.getByRole('textbox')).toHaveClass('font-code', 'resize-y');
});

test('typing fills the input and the textarea, Enter adds a line only in the textarea, Escape clears neither', async () => {
  const onChange = vi.fn();
  const { user } = renderWithProviders(
    <>
      <TextInput aria-label="Line" onChange={onChange} />
      <Textarea aria-label="Notes" />
    </>,
  );
  await user.tab();
  await user.keyboard('ab{Escape}{Enter}');
  expect(screen.getByRole('textbox', { name: 'Line' })).toHaveValue('ab');
  expect(onChange).toHaveBeenCalledTimes(2);
  await user.tab();
  await user.keyboard('x{Enter}y{Escape}');
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('x\ny');
});

test('a disabled TextInput is skipped by Tab', async () => {
  const { user } = renderWithProviders(
    <>
      <TextInput aria-label="Off" disabled />
      <TextInput aria-label="On" />
    </>,
  );
  await user.tab();
  expect(screen.getByRole('textbox', { name: 'On' })).toHaveFocus();
});

test('a TextInput, a Textarea and a Field of them pass axe', async () => {
  const { container } = renderWithProviders(
    <>
      <TextInput aria-label="Value" />
      <Textarea aria-label="Notes" />
      <Field label="Display name" error="Too long" description="Public">
        <TextInput placeholder="Ada" />
      </Field>
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name typed into either control is the value, as typed, and nothing is parsed from it', () => {
  for (const name of HOSTILE_NAMES) {
    const { container, unmount } = renderWithProviders(
      <>
        <TextInput aria-label="Line" defaultValue={name} />
        <Textarea aria-label="Notes" defaultValue={name} />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Line' })).toHaveValue(name);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(name);
    expect(container.querySelectorAll('script, img, a')).toHaveLength(0);
    unmount();
  }
});

test('a hostile name as the placeholder, the label and the title attributes stays text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <Field label={name}>
        <TextInput placeholder={name} title={name} />
      </Field>,
    ),
  );
});
