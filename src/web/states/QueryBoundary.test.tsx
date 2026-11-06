// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { answer, envelope, json, listThings, THING, testClient } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from './EmptyState.tsx';
import { QueryBoundary } from './QueryBoundary.tsx';

// E17-S07: QueryBoundary over a real query and an MSW server: loading to data, to empty, to error, retry to data, and a
// refetch that fails while data is on screen.

const { client } = testClient();

/** A page that lists things through `QueryBoundary`, with a button before it (to see where focus is) and one that refetches. */
function Things({ withEmpty = true }: { readonly withEmpty?: boolean }) {
  const query = useQuery({ queryKey: ['things'], queryFn: () => client.call(listThings) });
  const empty = <EmptyState level={2} title="No things" description="Add one first." />;
  const list = (things: readonly { readonly id: string }[]) => (
    <ul>
      {things.map((thing) => (
        <li key={thing.id}>{thing.id}</li>
      ))}
    </ul>
  );
  return (
    <>
      <button type="button">Outside</button>
      <Button
        onClick={() => {
          void query.refetch();
        }}
      >
        Refresh
      </Button>
      {withEmpty ? (
        <QueryBoundary query={query} isEmpty={(things) => things.length === 0} empty={empty}>
          {list}
        </QueryBoundary>
      ) : (
        <QueryBoundary query={query}>{list}</QueryBoundary>
      )}
    </>
  );
}

/** A page that has no heading of its own before the data is there (E18-S04): the error state is its level-one heading. */
function TopLevel() {
  const query = useQuery({ queryKey: ['things'], queryFn: () => client.call(listThings) });
  return (
    <QueryBoundary query={query} errorLevel={1}>
      {() => <p>data</p>}
    </QueryBoundary>
  );
}

test('the error state is a level-two heading unless the page says it is the level-one heading', async () => {
  answer('/api/things', envelope(500, 'internal_server_error'));
  renderWithProviders(<Things />);
  expect(await screen.findByRole('heading', { level: 2, name: messages['states.error.title'] })).toBeInTheDocument();
  cleanup();
  renderWithProviders(<TopLevel />);
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
});

test('loading to data: the loading state shows first, then the data, and the loading state is gone', async () => {
  answer('/api/things', json([THING]));
  renderWithProviders(<Things />);
  expect(screen.getByRole('status')).toHaveTextContent(messages['states.loading']);
  expect(await screen.findByText('abc')).toBeInTheDocument();
  expect(screen.queryByText(messages['states.loading'])).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('data replacing the loading state does not move focus', async () => {
  answer('/api/things', json([THING]));
  const { user } = renderWithProviders(<Things />);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  await screen.findByText('abc');
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
});

test('loading to empty: an empty answer shows the empty state and not an empty list', async () => {
  answer('/api/things', json([]));
  renderWithProviders(<Things />);
  expect(await screen.findByRole('heading', { name: 'No things' })).toBeInTheDocument();
  expect(screen.queryByRole('list')).toBeNull();
});

test('without an isEmpty rule an empty answer is data: the screen decides what to draw', async () => {
  answer('/api/things', json([]));
  renderWithProviders(<Things withEmpty={false} />);
  expect(await screen.findByRole('list')).toBeEmptyDOMElement();
  expect(screen.queryByRole('heading', { name: 'No things' })).toBeNull();
});

test('loading to error: a failed first answer replaces the loading state with an alert that has the message and the request id', async () => {
  answer('/api/things', envelope(500, 'internal_server_error'));
  renderWithProviders(<Things />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(alert).getByText('req-00000001')).toBeInTheDocument();
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText(messages['states.loading'])).toBeNull();
});

test('retry to data: "Try again" asks again, shows the loading state, and then the data', async () => {
  answer('/api/things', envelope(500, 'internal_server_error'), json([THING]));
  const { user } = renderWithProviders(<Things />);
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('abc')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('retry to error: a second failure shows the error again, with its button', async () => {
  const seen = answer('/api/things', envelope(503, 'service_unavailable'));
  const { user } = renderWithProviders(<Things />);
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => {
    expect(seen).toHaveLength(2);
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('a refetch that fails while data is on screen keeps the data and adds an inline banner, never an error page', async () => {
  answer('/api/things', json([THING]), envelope(500, 'internal_server_error'));
  const { user } = renderWithProviders(<Things />);
  expect(await screen.findByText('abc')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent(messages['errors.internal_server_error']);
  expect(within(banner).queryByRole('heading')).toBeNull();
  expect(screen.getByText('abc')).toBeInTheDocument();
  expect(screen.getByRole('list')).toBeInTheDocument();
  expect(screen.queryByText(messages['states.loading'])).toBeNull();
});

test('the banner\'s "Try again" repeats the request, and the banner goes when it works, with the data still there', async () => {
  answer('/api/things', json([THING]), envelope(500, 'internal_server_error'), json([THING, { id: 'def', size: 1 }]));
  const { user } = renderWithProviders(<Things />);
  await screen.findByText('abc');
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('def')).toBeInTheDocument();
  expect(screen.getByText('abc')).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

test('a refetch that fails over an empty answer keeps the empty state under the banner', async () => {
  answer('/api/things', json([]), envelope(500, 'internal_server_error'));
  const { user } = renderWithProviders(<Things />);
  await screen.findByRole('heading', { name: 'No things' });
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'No things' })).toBeInTheDocument();
});

test('a 403 is the forbidden state, with no "Try again"', async () => {
  answer('/api/things', envelope(403, 'forbidden'));
  renderWithProviders(<Things />);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: messages['states.forbidden.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test('a 429 from the server disables "Try again" and counts down from Retry-After', async () => {
  answer('/api/things', envelope(429, 'too_many_requests', { 'retry-after': '30' }));
  renderWithProviders(<Things />);
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeDisabled();
  expect(screen.getByText('You can try again in 30 seconds.')).toBeInTheDocument();
});

test('a body that breaks the contract shows the contract message and nothing of the payload', async () => {
  answer('/api/things', json([{ id: 'SECRET-PAYLOAD', size: 'not a number' }]));
  renderWithProviders(<Things />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.contract']);
  expect(alert).not.toHaveTextContent('SECRET-PAYLOAD');
});

test('a network failure shows the network message', async () => {
  answer('/api/things');
  renderWithProviders(<Things />);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.network']);
});

test('each state passes axe: loading, data, empty, error and the banner over data', async () => {
  answer('/api/things', json([THING]), envelope(500, 'internal_server_error'));
  const { container, user } = renderWithProviders(<Things />);
  await expectNoA11yViolations(container);
  await screen.findByText('abc');
  await expectNoA11yViolations(container);
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});

test('the error and empty states pass axe', async () => {
  answer('/api/things', envelope(500, 'internal_server_error'));
  const error = renderWithProviders(<Things />);
  await error.findByRole('alert');
  await expectNoA11yViolations(error.container);
  error.unmount();
  answer('/api/things', json([]));
  const empty = renderWithProviders(<Things />);
  await empty.findByRole('heading', { name: 'No things' });
  await expectNoA11yViolations(empty.container);
});
