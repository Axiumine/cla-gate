// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { globex, heading, renderInstallations, serveTenants, summary, tenantOf } from './test-support.ts';

// E18-S04: the installation screens are `authenticated`: a visitor with no session is sent to the login before anything loads,
// and the main navigation leads to them.

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  ['/installations', '/api/auth/login?return_to=%2Finstallations'],
  ['/installations/5', '/api/auth/login?return_to=%2Finstallations%2F5'],
])(
  'a visitor without a session who opens %s is sent to the login, and nothing of any tenant is asked for',
  async (route, login) => {
    // The copy of `location` that the spy makes keeps the address the page has, so the page is put on the route first.
    window.history.replaceState(null, '', route);
    const assign = spyOnPageNavigation();
    const served = serveTenants([tenantOf(summary(), 'acme/widgets')]);
    renderWithProviders(createElement(AppRouter), { route });
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledExactlyOnceWith(login);
    });
    expect(served.list).toEqual([]);
    expect(served.repositories).toEqual([]);
    expect(screen.queryByRole('table')).toBeNull();
  },
);

test('the main navigation has "Installations", which leads to the list', async () => {
  serveTenants([tenantOf(summary(), 'acme/widgets'), tenantOf(globex(), 'globex/api')]);
  const { user } = renderInstallations('/');
  const link = await within(await screen.findByRole('navigation', { name: messages['nav.label'] })).findByRole('link', {
    name: messages['nav.installations'],
  });
  expect(link).toHaveAttribute('href', '/installations');
  await user.click(link);
  expect(await heading(messages['installations.title'])).toBeInTheDocument();
  expect(await screen.findByRole('table')).toBeInTheDocument();
});

test('the title of the tab is "Installations · CLA" on the list', async () => {
  serveTenants([tenantOf(summary(), 'acme/widgets'), tenantOf(globex(), 'globex/api')]);
  renderInstallations('/installations');
  await screen.findByRole('table');
  expect(document.title).toBe(`${messages['installations.title']} · CLA`);
});
