// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { renderWithProviders } from './test-support/render.tsx';

test('the app is one page: a main landmark holding the level-one heading', () => {
  renderWithProviders(<App />);
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1, name: 'CLA Platform' }));
});
