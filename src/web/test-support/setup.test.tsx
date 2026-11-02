// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, test } from 'vitest';
import { server } from './server.ts';

// What vitest.setup.ts promises every web test. Tests of one file run in the order written, and the second test of each
// pair proves what the setup did after the first.

test('a handler a test adds answers its request', async () => {
  server.use(http.get('/api/ping', () => HttpResponse.json({ pong: true })));
  expect(await (await fetch('/api/ping')).json()).toEqual({ pong: true });
});

test('the handler of the previous test is gone', async () => {
  await expect(fetch('/api/ping')).rejects.toThrow('fetch failed');
});

test('a request without a handler fails instead of reaching the network, and says so', async () => {
  const failure = await fetch('https://api.example.test/anything').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TypeError);
  expect(failure).toHaveProperty('cause.message', expect.stringContaining('"error" strategy'));
});

test('a test renders into the document', () => {
  render(<p>left over</p>);
  expect(screen.getByText('left over')).toBeInTheDocument();
});

test('the render of the previous test was cleaned up', () => {
  expect(screen.queryByText('left over')).not.toBeInTheDocument();
  expect(document.body).toBeEmptyDOMElement();
});
