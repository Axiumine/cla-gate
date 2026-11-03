// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Checkbox } from '../ui/Checkbox.tsx';
import { NoLayoutResizeObserver } from './layout.ts';
import { renderWithProviders } from './render.tsx';

// E17-S06: the stand-in for the layout observer jsdom lacks.

test('the setup gives every test a ResizeObserver', () => {
  expect(globalThis.ResizeObserver).toBe(NoLayoutResizeObserver);
});

test('it keeps what it watches until told to stop, and never reports a size', () => {
  const callback = vi.fn();
  const observer = new NoLayoutResizeObserver(callback);
  const first = document.createElement('div');
  const second = document.createElement('div');
  observer.observe(first);
  observer.observe(second);
  expect([...observer.targets]).toEqual([first, second]);
  observer.unobserve(first);
  expect([...observer.targets]).toEqual([second]);
  observer.disconnect();
  expect(observer.targets.size).toBe(0);
  expect(callback).not.toHaveBeenCalled();
});

test('a checkbox in a form, which measures its hidden input, renders', () => {
  renderWithProviders(
    <form>
      <Checkbox aria-label="Agree" name="agree" />
    </form>,
  );
  expect(screen.getByRole('checkbox', { name: 'Agree' })).toBeInTheDocument();
});

test('the setup gives every test a scrollTo that does nothing, so a navigation does not write jsdom\'s "not implemented" error', () => {
  const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.scrollTo(0, 100);
  expect(write).not.toHaveBeenCalled();
});
