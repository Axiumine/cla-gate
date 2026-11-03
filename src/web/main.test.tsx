// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, expect, test, vi } from 'vitest';
import { sessionRoute } from '../shared/auth-contract.ts';
import { DEFAULT_SOURCE_URL, metaRoute } from '../shared/meta.ts';
import { messages } from './i18n/index.ts';
import { server } from './test-support/server.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.resetModules();
});

/** Puts the element index.html has in the document, where main.tsx looks for it. */
function addRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return root;
}

test('main mounts the app into #root, and only there', async () => {
  // The server answers as it does for a visitor, so the app settles: a session request left unanswered keeps the loading
  // state, and its spinner timer, alive after the test file is gone (E17-S09).
  server.use(
    http.get(sessionRoute.path, () => HttpResponse.json({}, { status: 401 })),
    http.get(metaRoute.path, () =>
      HttpResponse.json({ sourceUrl: DEFAULT_SOURCE_URL, commit: null, installUrl: null }),
    ),
  );
  const root = addRoot();
  const elsewhere = document.createElement('p');
  document.body.append(elsewhere);
  await import('./main.tsx');
  expect(await within(root).findByRole('heading', { level: 1, name: 'CLA Platform' })).toBeInTheDocument();
  // The header offers the login and so does the page: the session has been answered and nothing is left loading.
  expect(await within(root).findAllByRole('link', { name: messages['auth.login'] })).toHaveLength(2);
  expect(elsewhere).toBeEmptyDOMElement();
});

test('main fails loudly when index.html has no #root, instead of mounting nowhere', async () => {
  await expect(import('./main.tsx')).rejects.toThrow('index.html has no #root element to mount the app into');
  expect(document.body).toBeEmptyDOMElement();
});
