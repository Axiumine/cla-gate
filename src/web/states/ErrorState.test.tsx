// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { ApiError, ContractError, NetworkError } from '../api/errors.ts';
import { REQUEST_ID } from '../api/response.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ErrorState } from './ErrorState.tsx';

// E17-S07: ErrorState. A role=alert whose words come from errorMessage and never from the error, the request id with a
// copy button, "Try again", and the forbidden state.

const apiError = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: 500, code: 'internal_server_error', requestId: 'req-00000001', ...init });

test('it is a role=alert, with a heading of level 2 by default, the message of the code and the request id', () => {
  renderWithProviders(<ErrorState error={apiError()} />);
  const alert = screen.getByRole('alert');
  expect(within(alert).getByRole('heading', { level: 2, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(alert).getByText('req-00000001').tagName).toBe('CODE');
});

test("the heading level is the caller's", () => {
  renderWithProviders(<ErrorState error={apiError()} level={4} />);
  expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
});

test('the text is errorMessage(error): the message of the error and the wording of the server never appear', () => {
  const error = apiError({ code: 'not_found', status: 404 });
  Object.defineProperty(error, 'message', { value: 'SECRET server wording: table users' });
  renderWithProviders(<ErrorState error={error} />);
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
});

test.each([
  ['an Error', new Error('SECRET payload')],
  ['a string', 'SECRET payload'],
  ['undefined', undefined],
])('%s gets the unknown message and no request id', (_what, error) => {
  renderWithProviders(<ErrorState error={error} />);
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.unknown']);
  expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
  expect(screen.queryByText('Request ID')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy request ID' })).toBeNull();
});

test('a network error gets its own message and no request id', () => {
  renderWithProviders(<ErrorState error={new NetworkError(new TypeError('Failed to fetch'))} />);
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.network']);
  expect(screen.queryByText('Request ID')).toBeNull();
});

test('a ContractError shows the generic contract message and nothing of the payload', () => {
  const error = new ContractError('GET /api/repos/:id', 'response', ['items.0.name']);
  renderWithProviders(<ErrorState error={error} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.contract']);
  expect(alert).not.toHaveTextContent('items.0.name');
  expect(alert).not.toHaveTextContent('GET /api');
  expect(screen.queryByText('Request ID')).toBeNull();
});

test("an ApiError without a request id shows none, and one with a request id that does not look like the server's shows none", () => {
  const { rerender } = renderWithProviders(<ErrorState error={apiError({ requestId: undefined })} />);
  expect(screen.queryByText('Request ID')).toBeNull();
  rerender(<ErrorState error={apiError({ requestId: '<b>x</b>' })} />);
  expect(screen.queryByText('Request ID')).toBeNull();
});

test('the copy button copies the request id', async () => {
  const { user } = renderWithProviders(<ErrorState error={apiError()} />);
  await user.click(screen.getByRole('button', { name: 'Copy request ID' }));
  expect(await screen.findByText('Request ID copied')).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe('req-00000001');
});

test('"Try again" calls refetch, once per press, with the mouse, Enter and Space', async () => {
  const refetch = vi.fn();
  const { user } = renderWithProviders(<ErrorState error={apiError()} refetch={refetch} />);
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refetch).toHaveBeenCalledTimes(1);
  screen.getByRole('button', { name: 'Try again' }).focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(refetch).toHaveBeenCalledTimes(3);
});

test('without refetch there is no "Try again"', () => {
  renderWithProviders(<ErrorState error={apiError()} />);
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test('while retrying, "Try again" is busy, ignores clicks and keeps focus', async () => {
  const refetch = vi.fn();
  const { user } = renderWithProviders(<ErrorState error={apiError()} refetch={refetch} retrying />);
  const button = screen.getByRole('button', { name: 'Try again' });
  await user.click(button);
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(refetch).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
});

test('Tab goes from "Try again" to the copy button, in reading order, and to the extra actions after them', async () => {
  const { user } = renderWithProviders(
    <ErrorState error={apiError()} refetch={vi.fn()}>
      <a href="/">Home</a>
    </ErrorState>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Copy request ID' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus();
});

test('a 403 is the forbidden state: its own heading, the message of its code, the request id and no "Try again"', () => {
  renderWithProviders(<ErrorState error={apiError({ status: 403, code: 'forbidden' })} refetch={vi.fn()} />);
  const alert = screen.getByRole('alert');
  expect(within(alert).getByRole('heading', { name: messages['states.forbidden.title'] })).toBeInTheDocument();
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).getByText('req-00000001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test('a 403 whose code is the CSRF one is the forbidden state with the words of that code', () => {
  renderWithProviders(<ErrorState error={apiError({ status: 403, code: 'csrf_invalid' })} />);
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.csrf_invalid']);
  expect(screen.getByRole('heading')).toHaveTextContent(messages['states.forbidden.title']);
});

test('the banner variant is one message with no heading, above content that stays, and keeps the retry and the request id', () => {
  renderWithProviders(<ErrorState error={apiError()} refetch={vi.fn()} variant="banner" />);
  const alert = screen.getByRole('alert');
  expect(screen.queryByRole('heading')).toBeNull();
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(within(alert).getByText('req-00000001')).toBeInTheDocument();
});

const KINDS: readonly [string, unknown][] = [
  ['server', apiError()],
  ['forbidden', apiError({ status: 403, code: 'forbidden' })],
  ['network', new NetworkError(new Error('x'))],
  ['contract', new ContractError('GET /api/x', 'response', [])],
  ['other', new Error('x')],
];

test('every kind of error, as a page and as a banner, passes axe', async () => {
  const { container } = renderWithProviders(
    <>
      {KINDS.map(([kind, error]) => (
        <ErrorState key={kind} error={error} refetch={vi.fn()} level={3} />
      ))}
      <ErrorState error={apiError()} variant="banner" refetch={vi.fn()} />
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name as the code or as the message of the error is never drawn', () => {
  for (const name of HOSTILE_NAMES) {
    const error = apiError({ code: name });
    Object.defineProperty(error, 'message', { value: name });
    const view = renderWithProviders(<ErrorState error={error} refetch={vi.fn()} />);
    expect(activeContent(view.container), `rendering ${JSON.stringify(name)}`).toEqual([]);
    expect(view.container.textContent).toContain(messages['errors.unknown']);
    expect(view.container.textContent).not.toContain(name);
    view.unmount();
  }
});

test('a hostile name as the request id is drawn as text when it looks like an id, and not at all when it does not', () => {
  for (const name of HOSTILE_NAMES) {
    const view = renderWithProviders(<ErrorState error={apiError({ requestId: name })} />);
    expect(activeContent(view.container), `rendering ${JSON.stringify(name)}`).toEqual([]);
    expect(view.container.textContent.includes(name), JSON.stringify(name)).toBe(REQUEST_ID.test(name));
    view.unmount();
  }
});
