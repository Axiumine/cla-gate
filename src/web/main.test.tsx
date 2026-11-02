// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

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
  const root = addRoot();
  const elsewhere = document.createElement('p');
  document.body.append(elsewhere);
  await import('./main.tsx');
  expect(await within(root).findByRole('heading', { level: 1, name: 'CLA Platform' })).toBeInTheDocument();
  expect(elsewhere).toBeEmptyDOMElement();
});

test('main fails loudly when index.html has no #root, instead of mounting nowhere', async () => {
  await expect(import('./main.tsx')).rejects.toThrow('index.html has no #root element to mount the app into');
  expect(document.body).toBeEmptyDOMElement();
});
