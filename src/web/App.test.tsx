// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { messages } from './i18n/index.ts';
import { renderWithProviders } from './test-support/render.tsx';

test('the app is one page: a main landmark holding the level-one heading', () => {
  renderWithProviders(<App />);
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1, name: 'CLA Platform' }));
});

test('the heading is the app name of the message catalog, and the page language is set by the i18n provider', () => {
  document.documentElement.lang = '';
  renderWithProviders(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages['app.name']);
  expect(document.documentElement.lang).toBe('en');
});
