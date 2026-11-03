// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { systemColorScheme } from '../test-support/theme.ts';
import { type ThemeValue, useTheme } from './context.ts';
import type { ThemeMode } from './model.ts';
import { ThemeProvider } from './ThemeProvider.tsx';

// E17-S05: what ThemeProvider and useTheme() do. The visible toggle is E17-S09; here a probe stands in for it.

afterEach(() => {
  vi.restoreAllMocks();
});

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Shows the theme and has one button per mode. */
function Probe() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <div>
      <p>{`${mode}|${resolved}`}</p>
      {MODES.map((next) => (
        <button
          key={next}
          type="button"
          onClick={() => {
            setMode(next);
          }}
        >
          {next}
        </button>
      ))}
    </div>
  );
}

function renderProbe() {
  return {
    user: userEvent.setup(),
    ...render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    ),
  };
}

const theme = () => document.documentElement.getAttribute('data-theme');

/** Calls a hook and shows nothing. */
function Run({ hook }: { readonly hook: () => unknown }) {
  hook();
  return null;
}

/** What the last renders of `Run hook={useCapture}` saw of the theme. */
const captured: ThemeValue[] = [];
function useCapture() {
  captured.push(useTheme());
}

test('on a first visit the mode is system and the resolved theme is the system one', () => {
  renderProbe();
  expect(screen.getByText('system|light')).toBeInTheDocument();
  expect(theme()).toBe('light');
});

test('on a first visit on a dark system the page is dark', () => {
  systemColorScheme.set(true);
  renderProbe();
  expect(screen.getByText('system|dark')).toBeInTheDocument();
  expect(theme()).toBe('dark');
});

test.each([
  ['light', false, 'light|light', 'light'],
  ['light', true, 'light|light', 'light'],
  ['dark', false, 'dark|dark', 'dark'],
  ['dark', true, 'dark|dark', 'dark'],
])('a stored %s (system dark = %s) is the mode at the start', (stored, systemDark, text, applied) => {
  localStorage.setItem('cla.theme', stored);
  systemColorScheme.set(systemDark);
  renderProbe();
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(theme()).toBe(applied);
});

test('an invalid stored value falls back to system, and the app works', () => {
  localStorage.setItem('cla.theme', 'neon');
  systemColorScheme.set(true);
  renderProbe();
  expect(screen.getByText('system|dark')).toBeInTheDocument();
  expect(theme()).toBe('dark');
});

test('setMode updates data-theme and storage at once', async () => {
  const { user } = renderProbe();
  await user.click(screen.getByRole('button', { name: 'dark' }));
  expect(theme()).toBe('dark');
  expect(localStorage.getItem('cla.theme')).toBe('dark');
  expect(screen.getByText('dark|dark')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'light' }));
  expect(theme()).toBe('light');
  expect(localStorage.getItem('cla.theme')).toBe('light');
  expect(Object.keys(localStorage)).toEqual(['cla.theme']);
});

test('setMode applies the theme before React renders again, so there is no frame on the old one', () => {
  captured.length = 0;
  render(
    <ThemeProvider>
      <Run hook={useCapture} />
    </ThemeProvider>,
  );
  const setMode = captured.at(-1)?.setMode ?? (() => undefined);
  act(() => {
    setMode('dark');
    expect(theme()).toBe('dark');
    expect(localStorage.getItem('cla.theme')).toBe('dark');
  });
});

test('choosing system applies what the system prefers now and keeps following it', async () => {
  localStorage.setItem('cla.theme', 'light');
  systemColorScheme.set(true);
  const { user } = renderProbe();
  expect(theme()).toBe('light');
  await user.click(screen.getByRole('button', { name: 'system' }));
  expect(theme()).toBe('dark');
  expect(screen.getByText('system|dark')).toBeInTheDocument();
  expect(localStorage.getItem('cla.theme')).toBe('system');
  act(() => {
    systemColorScheme.set(false);
  });
  expect(theme()).toBe('light');
});

test('in system mode a change of the system preference updates resolved and data-theme, both ways', () => {
  renderProbe();
  expect(screen.getByText('system|light')).toBeInTheDocument();
  act(() => {
    systemColorScheme.set(true);
  });
  expect(screen.getByText('system|dark')).toBeInTheDocument();
  expect(theme()).toBe('dark');
  act(() => {
    systemColorScheme.set(false);
  });
  expect(screen.getByText('system|light')).toBeInTheDocument();
  expect(theme()).toBe('light');
});

test.each(['light', 'dark'] as const)('in %s mode a change of the system preference changes nothing', (mode) => {
  localStorage.setItem('cla.theme', mode);
  renderProbe();
  act(() => {
    systemColorScheme.set(true);
  });
  act(() => {
    systemColorScheme.set(false);
  });
  expect(screen.getByText(`${mode}|${mode}`)).toBeInTheDocument();
  expect(theme()).toBe(mode);
});

test('a storage that throws does not break rendering: the mode is system, a choice still applies, and nothing is stored', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  const { user } = renderProbe();
  expect(screen.getByText('system|light')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'dark' }));
  expect(screen.getByText('dark|dark')).toBeInTheDocument();
  expect(theme()).toBe('dark');
  expect(localStorage).toHaveLength(0);
});

test('the provider stops listening to the system when it unmounts', () => {
  const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
  const { unmount } = renderProbe();
  unmount();
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
});

test('setMode keeps one identity across renders, so it is safe in a dependency list', () => {
  captured.length = 0;
  const { rerender } = render(
    <ThemeProvider>
      <Run hook={useCapture} />
    </ThemeProvider>,
  );
  act(() => {
    systemColorScheme.set(true);
  });
  rerender(
    <ThemeProvider>
      <Run hook={useCapture} />
    </ThemeProvider>,
  );
  expect(captured.length).toBeGreaterThanOrEqual(3);
  expect(new Set(captured.map((value) => value.setMode)).size).toBe(1);
  expect(captured.at(-1)?.resolved).toBe('dark');
});

test('useTheme outside the provider fails loudly instead of choosing a theme', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Run hook={useTheme} />)).toThrow('The theme needs a ThemeProvider above the component');
});
