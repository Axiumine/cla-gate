// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { messages } from './i18n/index.ts';
import { renderWithProviders } from './test-support/render.tsx';

test('the app is one page: a main landmark holding the level-one heading', async () => {
  renderWithProviders(<App />);
  expect(await screen.findByRole('main')).toContainElement(
    await screen.findByRole('heading', { level: 1, name: 'CLA Platform' }),
  );
});

test('the heading is the app name of the message catalog, and the page language is set by the i18n provider', async () => {
  document.documentElement.lang = '';
  renderWithProviders(<App />);
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(messages['app.name']);
  expect(document.documentElement.lang).toBe('en');
});

test('the app starts on the page of the address it was opened at', async () => {
  renderWithProviders(<App />, { route: '/login/failed?reason=bad_request' });
  expect(await screen.findByRole('heading', { level: 1, name: messages['login.failed.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['login.failed.bad_request'])).toBeInTheDocument();
});
