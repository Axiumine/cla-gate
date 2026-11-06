// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import { expect, vi } from 'vitest';
import type { z } from 'zod';
import {
  type AppManifest,
  type convertResponseSchema,
  setupConvertRoute,
  setupManifestRoute,
  setupSessionRoute,
  setupStatusRoute,
  setupUnlockRoute,
} from '../../shared/setup.ts';
import { answer, envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';

// The server of the setup, as MSW answers for it in the tests of the setup pages (E19-S07): each route answers what a server
// in setup mode answers unless the test says otherwise, and every request is recorded. All values are made up.

/** The `state` of the manifest: 43 base64url characters, as the server makes it. */
export const STATE = 's'.repeat(43);
/** GitHub's one-time code. */
export const CODE = 'a180b1a3d263c81bc6441d7b990bae27d4c10679';
/** The CSRF token of the setup session. */
export const SETUP_CSRF = 'c'.repeat(43);
/** The setup token the operator pastes. */
export const SETUP_TOKEN = 'made-up-setup-token-0123456789abcdef';
export const ACTION_URL = `https://github.com/settings/apps/new?state=${STATE}`;

export const MANIFEST: AppManifest = {
  name: 'CLA Gate localhost-3000',
  url: 'https://cla.example.org',
  hook_attributes: { url: 'https://cla.example.org/webhooks/github', active: true },
  redirect_url: 'https://cla.example.org/setup/callback',
  callback_urls: ['https://cla.example.org/api/auth/callback'],
  setup_url: 'https://cla.example.org/',
  setup_on_update: false,
  public: false,
  request_oauth_on_install: false,
  default_permissions: { metadata: 'read' },
  default_events: ['pull_request'],
};

type Converted = z.infer<typeof convertResponseSchema>;

/** What the conversion answers with: made-up values, one per credential, each easy to find in a page or a log. */
export const CONVERTED: Converted = {
  appId: 424242,
  slug: 'cla-gate-test',
  htmlUrl: 'https://github.com/apps/cla-gate-test',
  installUrl: 'https://github.com/apps/cla-gate-test/installations/new',
  clientId: 'Iv1.made-up-client-id',
  clientSecret: 'made-up-client-secret-VALUE-1',
  webhookSecret: 'made-up-webhook-secret-VALUE-2',
  privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nmade-up-private-key-VALUE-3\n-----END RSA PRIVATE KEY-----\n',
};

/** The answers of the routes; a test names the ones it changes. */
export interface SetupAnswers {
  readonly status?: Response;
  readonly unlock?: Response;
  readonly manifest?: Response;
  readonly session?: Response;
  readonly convert?: Response;
}

/** The requests each route received, in order. */
export interface SetupCalls {
  readonly status: Seen[];
  readonly unlock: Seen[];
  readonly manifest: Seen[];
  readonly session: Seen[];
  readonly convert: Seen[];
}

/** A server in setup mode, answering `answers` and the standard answer for every route left out. */
export function serveSetup(answers: SetupAnswers = {}): SetupCalls {
  return {
    status: answer(setupStatusRoute.path, answers.status ?? json({ mode: 'setup' })),
    unlock: answer(setupUnlockRoute.path, answers.unlock ?? json({ csrfToken: SETUP_CSRF })),
    manifest: answer(
      setupManifestRoute.path,
      answers.manifest ?? json({ actionUrl: ACTION_URL, manifest: MANIFEST, state: STATE }),
    ),
    session: answer(setupSessionRoute.path, answers.session ?? json({ csrfToken: SETUP_CSRF })),
    convert: answer(setupConvertRoute.path, answers.convert ?? json(CONVERTED)),
  };
}

/** A server that is configured: it has no setup, so the status says so. */
export function serveConfigured(): SetupCalls {
  return serveSetup({ status: json({ mode: 'configured' }) });
}

/** The error body of the setup routes: `code` with its standard status. */
export function failure(status: number, code: string, headers: Record<string, string> = {}): Response {
  return envelope(status, code, headers);
}

/** Spies on every method of `console`, silenced, and returns a function that lists everything they were called with, as text: `[]` when nothing was logged. */
export function spyOnConsole(): () => string {
  const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
    vi.spyOn(console, method).mockReturnValue(undefined),
  );
  // type-coverage:ignore-next-line -- console methods take any[], so their recorded calls are any[][]; they are only turned into text
  return () => JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

/** Types the setup token into the unlock step, presses "Unlock" and waits for the form step. */
export async function unlockThroughThePage(user: UserEvent): Promise<void> {
  await user.type(await screen.findByLabelText(messages['setup.unlock.token']), SETUP_TOKEN);
  await user.click(screen.getByRole('button', { name: messages['setup.unlock.submit'] }));
  await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
}

/**
 * Replaces `requestSubmit` of forms, which this version of jsdom does not implement ("Not implemented" is printed and nothing
 * is submitted), with a spy that records the form it was called on. `vi.restoreAllMocks()` puts the original back.
 */
export function stubRequestSubmit() {
  return vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => undefined);
}

/**
 * Stands in for the parts of the browser that save a file and that jsdom does not have: `URL.createObjectURL` and
 * `URL.revokeObjectURL` (the global `URL` is replaced until `vi.unstubAllGlobals()`), and the click of a link, which is
 * recorded and goes nowhere. `saved()` lists the links that were clicked, by their `download` name.
 */
export function stubDownloads() {
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:made-up-address');
  const revoke = vi.fn<(address: string) => void>();
  class StubUrl extends URL {
    static override readonly createObjectURL = create;
    static override readonly revokeObjectURL = revoke;
  }
  vi.stubGlobal('URL', StubUrl);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return {
    create,
    revoke,
    saved: () =>
      click.mock.contexts
        .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
        .map((link) => ({ name: link.download, address: link.href })),
  };
}

/**
 * The `429` of a download (`Retry-After: 3`): the countdown, the standard message with its request id, and nothing saved. It
 * returns the alert, so a test can look into it.
 */
export async function expectRateLimitedDownload(downloads: ReturnType<typeof stubDownloads>): Promise<HTMLElement> {
  expect(await screen.findByText('You can try again in 3 seconds.')).toBeInTheDocument();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.too_many_requests']);
  expect(alert).toHaveTextContent('req-00000001');
  expect(downloads.saved()).toEqual([]);
  return alert;
}

const named = (template: string, name: string) => template.replace('{name}', name);

/** The "Copy" button of the credential called `name`: its accessible name says which value it copies. */
export const copyButton = (name: string) =>
  screen.getByRole('button', { name: named(messages['setup.item.copyNamed'], name) });
/** The "Reveal" button of the secret called `name`. */
export const revealButton = (name: string) =>
  screen.getByRole('button', { name: named(messages['setup.item.revealNamed'], name) });
/** The "Hide" button of the secret called `name`, which stands where "Reveal" stood once the secret is shown. */
export const hideButton = (name: string) =>
  screen.getByRole('button', { name: named(messages['setup.item.hideNamed'], name) });
/** The "Download" button of the credential called `name`. */
export const downloadButton = (name: string) =>
  screen.getByRole('button', { name: named(messages['setup.item.downloadNamed'], name) });

/** The address GitHub sends the browser back to: the one-time code and the state of the manifest. */
const CALLBACK_ROUTE = `/setup/callback?code=${CODE}&state=${STATE}`;

/** The app at the callback, the button pressed and the credentials on the screen; `calls` are the requests the server received. */
export async function openCredentials(answers: SetupAnswers = {}) {
  const calls = serveSetup(answers);
  const rendered = renderWithProviders(createElement(AppRouter), { route: CALLBACK_ROUTE });
  await rendered.user.click(await screen.findByRole('button', { name: messages['setup.callback.get'] }));
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  return { ...rendered, calls };
}
