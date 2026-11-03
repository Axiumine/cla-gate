// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { within } from '@testing-library/react';
import { expect } from 'vitest';
import { messages } from '../i18n/index.ts';

/**
 * The crash fallback for a 500 whose request id is `req-00000001` (E17-S07): an `h1`, the generic message, the request id in
 * a `code` element and a Reload button, all inside the alert.
 */
export function expectServerErrorFallback(alert: HTMLElement): void {
  expect(within(alert).getByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(alert).getByText('req-00000001').tagName).toBe('CODE');
  expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
}
