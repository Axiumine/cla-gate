// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_SOURCE_URL } from '../../shared/meta.ts';
import { ApiError } from '../api/errors.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { RootErrorBoundary } from './RootErrorBoundary.tsx';

// E17-S07: the root error boundary. A render error shows a fallback with "Reload" and the request id when there is one; it
// logs the name and the request id to the console and sends nothing anywhere.

let logged: unknown[][] = [];
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  // React reports a caught render error to the console as well; the spy keeps the run quiet and records every call.
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  server.events.on('request:start', ({ request }) => {
    requests.push(request.url);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.unstubAllGlobals();
});

function Boom({ error }: { readonly error: unknown }): never {
  throw error;
}

/** The calls the boundary itself made to console.error, as opposed to React's report of the same error. */
const ownLogs = () => logged.filter(([first]) => typeof first === 'string' && first.startsWith('Unhandled '));

const serverError = () => new ApiError({ status: 500, code: 'internal_server_error', requestId: 'req-00000001' });

test('without an error it renders its children and nothing else', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <p>The page</p>
    </RootErrorBoundary>,
  );
  expect(screen.getByText('The page')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(ownLogs()).toEqual([]);
});

test('a render error shows the fallback in a main landmark: an h1, the generic message, the request id and a Reload button', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  const main = screen.getByRole('main');
  const alert = within(main).getByRole('alert');
  expect(within(alert).getByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(alert).getByText('req-00000001').tagName).toBe('CODE');
  expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
});

test.each([
  ['an Error', new Error('SECRET message')],
  ['a string', 'SECRET string'],
  ['undefined', undefined],
  ['null', null],
])('%s thrown during render is caught too, and shows the generic message', (_what, error) => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={error} />
    </RootErrorBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.unknown']);
  expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
  expect(screen.queryByText('Request ID')).toBeNull();
});

test('it logs the name of the error and the request id to console.error, and no message, stack or payload of its own', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  expect(ownLogs()).toEqual([['Unhandled ApiError, request req-00000001']]);
});

test('a plain Error is logged by its name only', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={new RangeError('SECRET payload')} />
    </RootErrorBoundary>,
  );
  expect(ownLogs()).toEqual([['Unhandled RangeError']]);
});

test('nothing is reported over the network', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  expect(requests).toEqual([]);
});

test('a 403 thrown during render is the forbidden state, not a blank page', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={new ApiError({ status: 403, code: 'forbidden', requestId: 'req-00000002' })} />
    </RootErrorBoundary>,
  );
  expect(screen.getByRole('heading', { level: 1, name: messages['states.forbidden.title'] })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
});

test('"Reload" loads the page again, with the mouse, Enter and Space', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', Object.assign({}, window.location, { reload }));
  const { user } = renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  const button = screen.getByRole('button', { name: 'Reload' });
  await user.click(button);
  button.focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(reload).toHaveBeenCalledTimes(3);
});

test('what is beside the boundary stays on screen when the page crashes', () => {
  renderWithProviders(
    <>
      <RootErrorBoundary>
        <Boom error={serverError()} />
      </RootErrorBoundary>
      <aside>Beside</aside>
    </>,
  );
  expect(screen.getByRole('complementary')).toHaveTextContent('Beside');
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

test('the fallback has the source footer, so the offer of the source outlives a crash of the whole app (E17-S09)', () => {
  renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  const footer = screen.getByRole('contentinfo');
  expect(within(footer).getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute(
    'href',
    DEFAULT_SOURCE_URL,
  );
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('alert'));
});

test('the fallback passes axe', async () => {
  const { container } = renderWithProviders(
    <RootErrorBoundary>
      <Boom error={serverError()} />
    </RootErrorBoundary>,
  );
  await expectNoA11yViolations(container);
});
