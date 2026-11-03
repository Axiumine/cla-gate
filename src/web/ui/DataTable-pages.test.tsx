// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { defineRoute } from '../../shared/contract.ts';
import { envelope, testClient } from '../api/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { CursorPager } from './CursorPager.tsx';
import { DataTable } from './DataTable.tsx';
import { useSettled } from './use-cursor-trail.ts';

// E17-S10: a table and its pager over the API, the way a screen of E18 puts them together: a stale cursor makes the server
// answer 400, and the page on screen is still there when it does.

const listSigners = defineRoute({
  method: 'GET',
  path: '/api/signers',
  query: z.object({ cursor: z.string().optional() }),
  responses: {
    200: z.object({
      items: z.array(z.object({ id: z.string(), login: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  },
});

/**
 * Page 1 (no cursor) leads to `cursor-2`, page 2 leads to `stale-cursor`, which the server no longer accepts. The answer for
 * page 2 waits until the function this returns is called, if `held`, so a test can look at the screen while the page is on
 * its way.
 */
function serveSigners(held = false) {
  const gate = Promise.withResolvers<undefined>();
  if (!held) {
    gate.resolve(undefined);
  }
  server.use(
    http.get('/api/signers', async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor === null) {
        return HttpResponse.json({ items: [{ id: '1', login: 'octocat' }], nextCursor: 'cursor-2' });
      }
      if (cursor === 'cursor-2') {
        await gate.promise;
        return HttpResponse.json({ items: [{ id: '2', login: 'hubot' }], nextCursor: 'stale-cursor' });
      }
      return envelope(400, 'bad_request');
    }),
  );
  return () => {
    gate.resolve(undefined);
  };
}

const { client } = testClient();

function Signers() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ['signers', cursor],
    queryFn: () => client.call(listSigners, { query: { cursor } }),
    placeholderData: keepPreviousData,
  });
  // The page on screen is the last one that arrived: a request in flight or one that failed does not take it away.
  const page = useSettled(query.data, query.isSuccess && !query.isPlaceholderData);
  return (
    <>
      <DataTable
        caption="Signers"
        columns={[{ id: 'login', header: 'Login', userText: (row) => row.login }]}
        rows={page?.items ?? []}
        rowKey={(row) => row.id}
      />
      <CursorPager
        cursor={cursor}
        nextCursor={page?.nextCursor ?? null}
        loading={query.isFetching}
        failed={query.isError}
        onCursorChange={setCursor}
      />
    </>
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const status = () => screen.getByRole('status');
const login = (name: string) => within(screen.getByRole('table')).getByText(name);

test('the page stays on screen while the next one loads, and the next one replaces it with the page announced', async () => {
  const release = serveSigners(true);
  const { user } = renderWithProviders(<Signers />);
  expect(await screen.findByText('octocat')).toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 1');
  await user.click(button('Next'));
  expect(button('Next')).toBeDisabled();
  expect(button('Previous')).toBeDisabled();
  expect(login('octocat')).toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 1');
  release();
  expect(await screen.findByText('hubot')).toBeInTheDocument();
  expect(screen.queryByText('octocat')).not.toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 2');
  await waitFor(() => {
    expect(button('Next')).toBeEnabled();
  });
});

test('a stale cursor leaves the current page on screen with a message, and Previous still goes back', async () => {
  serveSigners();
  const { user } = renderWithProviders(<Signers />);
  await screen.findByText('octocat');
  await user.click(button('Next'));
  await screen.findByText('hubot');
  await waitFor(() => {
    expect(button('Next')).toBeEnabled();
  });
  await user.click(button('Next'));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('That page could not be loaded. The page you see has not changed.');
  expect(login('hubot')).toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 2');
  expect(button('Next')).toBeEnabled();
  expect(button('Previous')).toBeEnabled();
  await user.click(button('Previous'));
  expect(await screen.findByText('octocat')).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  expect(status()).toHaveTextContent('Page 1');
});

test('the table with its pager passes axe on a page and after a failed page', async () => {
  serveSigners();
  const { container, user } = renderWithProviders(<Signers />);
  await screen.findByText('octocat');
  await expectNoA11yViolations(container);
  await user.click(button('Next'));
  await screen.findByText('hubot');
  await waitFor(() => {
    expect(button('Next')).toBeEnabled();
  });
  await user.click(button('Next'));
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
