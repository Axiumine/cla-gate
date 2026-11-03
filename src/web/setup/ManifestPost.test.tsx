// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { TestRoutes } from '../test-support/router.tsx';
import { ManifestPost } from './ManifestPost.tsx';
import { ACTION_URL, MANIFEST, serveSetup, stubRequestSubmit, unlockThroughThePage } from './test-support.ts';

// E19-S07: the manifest is handed to GitHub with a real form and `requestSubmit()`, once, and only to an address on GitHub.

afterEach(() => {
  vi.restoreAllMocks();
});

// eslint-disable-next-line sonarjs/no-clear-text-protocols -- the address over plain http is the input these tests prove is refused
const PLAIN_HTTP_ADDRESS = 'http://github.com/settings/apps/new?state=x';

const continueButton = () => screen.getByRole('button', { name: messages['setup.post.continue'] });

/** The step, inside a router, which its link needs; the page it stands on is the only one. */
function step(actionUrl: string) {
  return (
    <TestRoutes
      route="/step"
      pages={[{ path: '/step', component: () => <ManifestPost actionUrl={actionUrl} manifest={MANIFEST} /> }]}
    />
  );
}

async function inRouter(actionUrl: string) {
  const rendered = renderWithProviders(step(actionUrl));
  await screen.findByRole('heading', { level: 1, name: messages['setup.post.title'] });
  return rendered;
}

test('it renders a real form that posts to the action URL with the manifest in a hidden input named manifest', async () => {
  stubRequestSubmit();
  const { container } = await inRouter(ACTION_URL);
  const form = container.querySelector('form');
  expect(form).toHaveAttribute('method', 'post');
  expect(form).toHaveAttribute('action', ACTION_URL);
  const inputs = [...(form?.querySelectorAll('input') ?? [])];
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toHaveAttribute('type', 'hidden');
  expect(inputs[0]).toHaveAttribute('name', 'manifest');
  expect(JSON.parse(inputs[0]?.value ?? '')).toEqual(MANIFEST);
});

test('it submits that form with requestSubmit, once, and no script or handler attribute is written into the page', async () => {
  const submit = stubRequestSubmit();
  const { container } = await inRouter(ACTION_URL);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.contexts[0]).toBe(container.querySelector('form'));
  expect(container.querySelector('script')).toBeNull();
  const handlers = [...container.querySelectorAll('*')].flatMap((element) =>
    element.getAttributeNames().filter((name) => name.startsWith('on')),
  );
  expect(handlers).toEqual([]);
  expect(container.querySelector('form')).not.toHaveAttribute('onsubmit');
});

test('under StrictMode, which runs every effect twice, the form is still submitted once', async () => {
  const submit = stubRequestSubmit();
  renderWithProviders(<StrictMode>{step(ACTION_URL)}</StrictMode>);
  await screen.findByRole('heading', { level: 1, name: messages['setup.post.title'] });
  expect(submit).toHaveBeenCalledOnce();
});

test('the button of the form submits it by hand, in case the browser did not: the submit event is the form posting to GitHub', async () => {
  stubRequestSubmit();
  const { user, container } = await inRouter(ACTION_URL);
  const seen: (string | undefined)[] = [];
  const listener = (event: Event) => {
    event.preventDefault();
    const form = event.target;
    seen.push(form instanceof HTMLFormElement ? form.action : undefined);
  };
  document.addEventListener('submit', listener);
  await user.click(continueButton());
  document.removeEventListener('submit', listener);
  expect(seen).toEqual([ACTION_URL]);
  expect(container.querySelector('form')).toHaveAttribute('action', ACTION_URL);
});

test('the step takes focus on its heading', async () => {
  stubRequestSubmit();
  await inRouter(ACTION_URL);
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: messages['setup.post.title'] })).toHaveFocus();
  });
});

test.each([
  'https://evil.example/settings/apps/new?state=x',
  PLAIN_HTTP_ADDRESS,
  'https://github.com.evil.example/settings/apps/new',
  'https://github.com@evil.example/settings/apps/new',
  'javascript:alert(1)',
  '//github.com/settings/apps/new',
  '/settings/apps/new',
  '',
])(
  'an action URL that is not on GitHub, %j, posts nothing: no form, the refusal, and the way to start again',
  async (url) => {
    const submit = stubRequestSubmit();
    const { container } = await inRouter(url);
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(messages['setup.post.refused']);
    expect(screen.getByRole('link', { name: messages['setup.startAgain'] })).toHaveAttribute('href', '/setup');
  },
);

test('no hostile name as an action URL posts anything either', async () => {
  const submit = stubRequestSubmit();
  for (const name of HOSTILE_NAMES) {
    const { container, unmount } = await inRouter(name);
    expect(container.querySelector('form'), JSON.stringify(name)).toBeNull();
    unmount();
  }
  expect(submit).not.toHaveBeenCalled();
});

test('through the page: the manifest the server returned is what is posted, to the address it returned, once', async () => {
  const submit = stubRequestSubmit();
  const calls = serveSetup();
  const { user, container } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await unlockThroughThePage(user);
  await user.click(screen.getByRole('button', { name: messages['setup.app.submit'] }));
  expect(await screen.findByRole('heading', { level: 1, name: messages['setup.post.title'] })).toBeInTheDocument();
  const form = container.querySelector('form[method="post"]');
  expect(form).toHaveAttribute('action', ACTION_URL);
  expect(JSON.parse(form?.querySelector<HTMLInputElement>('input[name="manifest"]')?.value ?? '')).toEqual(MANIFEST);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.contexts[0]).toBe(form);
  expect(calls.manifest).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: messages['setup.app.title'] })).toBeNull();
});

test.each([
  ['an address off GitHub', 'https://evil.example/settings/apps/new?state=ssssssssssssssssssssssssssssssssssssssssss'],
  ['an address with a longer query', `${ACTION_URL}&x=1`],
  ['a javascript address', 'javascript:alert(1)'],
])('through the page, %s in the answer fails the contract and posts nothing', async (_what, actionUrl) => {
  const submit = stubRequestSubmit();
  const { user, container } = renderWithProviders(<AppRouter />, { route: '/setup' });
  serveSetup({ manifest: json({ actionUrl, manifest: MANIFEST, state: 's'.repeat(43) }) });
  await unlockThroughThePage(user);
  await user.click(screen.getByRole('button', { name: messages['setup.app.submit'] }));
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.contract']);
  expect(container.querySelector('form[method="post"]')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

test('the posting step passes axe, and so does the refusal', async () => {
  stubRequestSubmit();
  const sent = await inRouter(ACTION_URL);
  await expectNoA11yViolations(sent.container);
  sent.unmount();
  const refused = await inRouter('https://evil.example/');
  await expectNoA11yViolations(refused.container);
});
