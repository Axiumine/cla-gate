// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectServerErrorFallback } from '../test-support/error-fallback.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { TestRoutes } from '../test-support/router.tsx';
import { server } from '../test-support/server.ts';
import { RouterErrorComponent } from './RouterErrorComponent.tsx';

// E17-S07: the router's errorComponent. A route that throws, in its loader or in its render, shows the crash fallback inside
// the page; the log has the name and the request id, and the network is not used.

let logged: unknown[][] = [];
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  server.events.on('request:start', ({ request }) => {
    requests.push(request.url);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.unstubAllGlobals();
});

const ownLogs = () => logged.filter(([first]) => typeof first === 'string' && first.startsWith('Unhandled '));

function failing(error: unknown, where: 'loader' | 'render') {
  const fail = (): never => {
    throw error;
  };
  return where === 'loader'
    ? { path: '/', component: () => <p>The page</p>, loader: fail }
    : { path: '/', component: fail };
}

function renderFailing(error: unknown, where: 'loader' | 'render' = 'render') {
  return renderWithProviders(
    <TestRoutes route="/" pages={[failing(error, where)]} errorComponent={RouterErrorComponent} />,
  );
}

const serverError = () => new ApiError({ status: 500, code: 'internal_server_error', requestId: 'req-00000001' });

test.each(['loader', 'render'] as const)(
  'a route that throws in its %s shows the fallback: an h1, the message, the request id and Reload',
  async (where) => {
    renderFailing(serverError(), where);
    const alert = await screen.findByRole('alert');
    expectServerErrorFallback(alert);
    expect(screen.queryByText('The page')).toBeNull();
  },
);

test('it logs the name of the error and the request id to console.error and sends nothing over the network', async () => {
  renderFailing(serverError());
  await screen.findByRole('alert');
  expect(ownLogs()).toContainEqual(['Unhandled ApiError, request req-00000001']);
  expect(ownLogs().every(([text]) => typeof text === 'string' && !text.includes('does not match'))).toBe(true);
  expect(requests).toEqual([]);
});

test('an error that is not an ApiError is logged by its name and shows the generic message, not its own', async () => {
  renderFailing(new RangeError('SECRET payload'));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.unknown']);
  expect(alert).not.toHaveTextContent('SECRET');
  expect(ownLogs()).toContainEqual(['Unhandled RangeError']);
  expect(JSON.stringify(ownLogs())).not.toContain('SECRET');
});

test.each(['loader', 'render'] as const)(
  'a 403 thrown in the %s is the forbidden state, not a blank page',
  async (where) => {
    renderFailing(new ApiError({ status: 403, code: 'forbidden', requestId: 'req-00000002' }), where);
    expect(
      await screen.findByRole('heading', { level: 1, name: messages['states.forbidden.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
    expect(screen.getByText('req-00000002')).toBeInTheDocument();
  },
);

test('"Reload" loads the page again, with the mouse, Enter and Space', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', Object.assign({}, window.location, { reload }));
  const { user } = renderFailing(serverError());
  const button = await screen.findByRole('button', { name: 'Reload' });
  await user.click(button);
  button.focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(reload).toHaveBeenCalledTimes(3);
});

test('the fallback passes axe', async () => {
  const { container } = renderFailing(serverError());
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
