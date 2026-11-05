// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  githubDown,
  githubLimited,
  heading,
  renderInstallations,
  serveTenants,
  summary,
  tenantOf,
} from './test-support.ts';

// E18-S04: a failed list is an error state and never an empty list, which would read as "you administer nothing".

const ACME = summary();
const notEmpty = () => {
  expect(screen.queryByRole('heading', { level: 2, name: messages['installations.empty.title'] })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
};

test('502 github_unavailable shows the error state with its message, the request id and "Try again", and no empty state', async () => {
  serveTenants([], githubDown);
  renderInstallations('/installations');
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.github_unavailable']);
  expect(state).toHaveTextContent('req-00000001');
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeEnabled();
  notEmpty();
  expect(await heading(messages['installations.title'])).toBeInTheDocument();
});

test('503 github_rate_limited shows its message and counts down the seconds the server asked for before "Try again" works', async () => {
  serveTenants([], () => githubLimited(42));
  renderInstallations('/installations');
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.github_rate_limited']);
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(screen.getByText('You can try again in 42 seconds.')).toBeInTheDocument();
  notEmpty();
});

test('a 503 that is not the rate limit of GitHub has no countdown and can be retried at once', async () => {
  serveTenants([], () =>
    Response.json(
      { error: { code: 'service_unavailable', message: 'x', requestId: 'req-00000001' } },
      { status: 503, headers: { 'retry-after': '42' } },
    ),
  );
  renderInstallations('/installations');
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeEnabled();
  expect(screen.queryByText(/You can try again in/)).toBeNull();
});

test('"Try again" asks again, and the list replaces the error', async () => {
  let failing = true;
  serveTenants([tenantOf(ACME), tenantOf(summary({ id: 8, accountLogin: 'other' }))], () =>
    failing ? githubDown() : Response.json([ACME, summary({ id: 8, accountLogin: 'other' })]),
  );
  const { user } = renderInstallations('/installations');
  await screen.findByRole('alert');
  failing = false;
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a failing list, with and without the countdown, passes axe', async () => {
  serveTenants([], () => githubLimited(5));
  const { container } = renderInstallations('/installations');
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
