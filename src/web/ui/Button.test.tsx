// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Button } from './Button.tsx';
import type { ButtonVariant } from './button-styles.ts';

// E17-S06: Button. Variants, the loading state (busy, inert, still focused), the icon-only rule, the keyboard, axe, hostile text.

const VARIANTS: readonly [ButtonVariant, string][] = [
  ['primary', 'bg-accent'],
  ['secondary', 'bg-surface'],
  ['danger', 'bg-danger'],
  ['ghost', 'bg-transparent'],
];

const icon = <svg viewBox="0 0 16 16" data-testid="icon" />;

test.each(VARIANTS)('the %s variant is drawn with its own fill (%s)', (variant, fill) => {
  renderWithProviders(<Button variant={variant}>Save</Button>);
  expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(fill);
});

test('a button without a variant is secondary, and is type=button so that it never submits a form by accident', () => {
  renderWithProviders(<Button>Save</Button>);
  const button = screen.getByRole('button', { name: 'Save' });
  expect(button).toHaveClass('bg-surface');
  expect(button).toHaveAttribute('type', 'button');
});

test('a click calls onClick once, and the caller can set type=submit and the other native attributes', async () => {
  const onClick = vi.fn();
  const { user } = renderWithProviders(
    <Button type="submit" form="settings" name="intent" value="save" onClick={onClick}>
      Save
    </Button>,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  expect(screen.getByRole('button')).toHaveAttribute('form', 'settings');
});

test('a button without onClick can be clicked', async () => {
  const { user } = renderWithProviders(<Button>Save</Button>);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
});

test('loading sets aria-busy, and a button that is not loading has no aria-busy at all', () => {
  const { rerender } = renderWithProviders(<Button>Save</Button>);
  expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  rerender(<Button loading>Save</Button>);
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
});

test('a loading button ignores clicks, Enter and Space, and keeps focus', async () => {
  const onClick = vi.fn();
  const { user } = renderWithProviders(
    <Button loading onClick={onClick}>
      Save
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Save' });
  await user.click(button);
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(onClick).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
  expect(button).not.toBeDisabled();
});

test('a loading submit button does not submit its form', async () => {
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
    event.preventDefault();
  });
  const { user, rerender } = renderWithProviders(
    <form onSubmit={onSubmit}>
      <Button type="submit" loading>
        Save
      </Button>
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).not.toHaveBeenCalled();
  rerender(
    <form onSubmit={onSubmit}>
      <Button type="submit">Save</Button>
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('focus stays on the button when it turns loading while it is focused', async () => {
  const { user, rerender } = renderWithProviders(<Button>Save</Button>);
  await user.tab();
  expect(screen.getByRole('button')).toHaveFocus();
  rerender(<Button loading>Save</Button>);
  expect(screen.getByRole('button')).toHaveFocus();
});

test('an icon-only button is named by its aria-label and hides the icon from assistive technology', () => {
  renderWithProviders(<Button icon={icon} aria-label="Close" />);
  expect(screen.getByRole('button', { name: 'Close' })).toContainElement(screen.getByTestId('icon'));
  expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
});

test('a button with an icon and a label shows both', () => {
  renderWithProviders(<Button icon={icon}>Save</Button>);
  const button = screen.getByRole('button', { name: 'Save' });
  expect(button).toContainElement(screen.getByTestId('icon'));
});

test('an icon-only button without aria-label is a type error', () => {
  // @ts-expect-error -- the point of the test: an icon with no label and no aria-label must not compile (E17-S06)
  renderWithProviders(<Button icon={icon} />);
  expect(screen.getByRole('button')).not.toHaveAccessibleName();
});

test('a className is added to the variant, not instead of it', () => {
  renderWithProviders(<Button className="w-full">Save</Button>);
  expect(screen.getByRole('button')).toHaveClass('w-full', 'bg-surface');
});

test('Tab reaches the buttons in order, Enter and Space press the focused one, Escape does nothing', async () => {
  const pressed: string[] = [];
  const { user } = renderWithProviders(
    <>
      <Button
        onClick={() => {
          pressed.push('first');
        }}
      >
        First
      </Button>
      <Button
        onClick={() => {
          pressed.push('second');
        }}
      >
        Second
      </Button>
    </>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  expect(pressed).toEqual(['first', 'first', 'second']);
});

test('every variant, loading and icon-only buttons pass axe', async () => {
  const { container } = renderWithProviders(
    <>
      {VARIANTS.map(([variant]) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
      <Button loading>Saving</Button>
      <Button icon={icon} aria-label="Close" />
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name in the label stays text', () => {
  expectHostileNamesInert((name) => renderWithProviders(<Button>{name}</Button>));
});
