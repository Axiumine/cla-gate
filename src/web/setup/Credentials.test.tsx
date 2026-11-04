// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  CONVERTED,
  copyButton,
  downloadButton,
  hideButton,
  openCredentials,
  revealButton,
  stubDownloads,
} from './test-support.ts';

// E19-S07: the credentials screen. Public values for the .env file and three secrets with the file each belongs in, each with
// a read-only field, Copy and Download, a notice that they are shown once, and the next steps.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MASK = '•'.repeat(16);

const field = (label: string) => screen.getByLabelText(label);
const PUBLIC = [
  ['GITHUB_APP_ID', String(CONVERTED.appId)],
  ['GITHUB_CLIENT_ID', CONVERTED.clientId],
] as const;
const SECRETS = [
  ['secrets/github_client_secret', CONVERTED.clientSecret],
  ['secrets/github_webhook_secret', CONVERTED.webhookSecret],
  ['secrets/github_app_private_key', CONVERTED.privateKeyPem],
] as const;

test('the screen takes focus on its heading, and says which values are public and which are secrets', async () => {
  await openCredentials();
  const heading = screen.getByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
  expect(
    screen.getByRole('heading', { level: 2, name: messages['setup.credentials.publicTitle'] }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: messages['setup.credentials.secretTitle'] }),
  ).toBeInTheDocument();
});

test.each(PUBLIC)(
  'the public value %s is in a read-only field, shown as it is, with Copy and Download but no Reveal',
  async (label, value) => {
    await openCredentials();
    expect(field(label)).toHaveValue(value);
    expect(field(label)).toHaveAttribute('readonly');
    expect(copyButton(label)).toBeInTheDocument();
    expect(downloadButton(label)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: messages['setup.item.revealNamed'].replace('{name}', label) }),
    ).toBeNull();
  },
);

test.each(SECRETS)(
  'the secret %s is in a read-only field, masked, and its value is nowhere in the page',
  async (label, value) => {
    const { container } = await openCredentials();
    expect(field(label)).toHaveValue(MASK);
    expect(field(label)).toHaveAttribute('readonly');
    expect(container.innerHTML).not.toContain(value.trim().split('\n')[1] ?? value);
    expect(document.body.innerHTML).not.toContain(value);
    expect(document.body.textContent).not.toContain(value);
    expect(revealButton(label)).toBeInTheDocument();
  },
);

test('the private key is a text area of several lines; the other values are one-line fields', async () => {
  await openCredentials();
  expect(field('secrets/github_app_private_key').tagName).toBe('TEXTAREA');
  expect(field('secrets/github_client_secret').tagName).toBe('INPUT');
  expect(field('GITHUB_APP_ID').tagName).toBe('INPUT');
});

test.each(SECRETS)('Reveal shows %s, Hide masks it again, and the button says which', async (label, value) => {
  const { user } = await openCredentials();
  await user.click(revealButton(label));
  expect(field(label)).toHaveValue(value);
  expect(hideButton(label)).toBeInTheDocument();
  await user.click(hideButton(label));
  expect(field(label)).toHaveValue(MASK);
  expect(document.body.innerHTML).not.toContain(value);
});

test('revealing one secret reveals no other', async () => {
  const { user } = await openCredentials();
  await user.click(revealButton('secrets/github_webhook_secret'));
  expect(field('secrets/github_client_secret')).toHaveValue(MASK);
  expect(field('secrets/github_app_private_key')).toHaveValue(MASK);
});

test('a prominent notice says the values are shown once and that GitHub can regenerate the client secret and the private key', async () => {
  await openCredentials();
  const notice = screen.getByRole('note');
  expect(notice).toHaveTextContent(messages['setup.credentials.once']);
  expect(messages['setup.credentials.once']).toMatch(/shown once/u);
  expect(messages['setup.credentials.once']).toMatch(
    /settings page of the App can generate a new client secret and a new private key/u,
  );
});

test.each([...PUBLIC, ...SECRETS])(
  'Copy puts %s on the clipboard, and a polite live region says so',
  async (label, value) => {
    const { user } = await openCredentials();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(copyButton(label));
    expect(write).toHaveBeenCalledExactlyOnceWith(value);
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((region) => region.textContent)).toContain(
        messages['setup.item.copied'].replace('{name}', label),
      );
    });
    expect(screen.getAllByRole('status').find((region) => region.textContent !== '')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  },
);

test('Copy copies the secret even while it is masked, and the mask stays', async () => {
  const { user } = await openCredentials();
  const write = vi.spyOn(navigator.clipboard, 'writeText');
  await user.click(copyButton('secrets/github_client_secret'));
  expect(write).toHaveBeenCalledExactlyOnceWith(CONVERTED.clientSecret);
  expect(field('secrets/github_client_secret')).toHaveValue(MASK);
});

test.each([
  [
    'the Clipboard API is missing',
    () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
  ],
  [
    'the Clipboard API refuses',
    () => vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied')),
  ],
])(
  'when %s, a message says to copy by hand or download, and nothing is announced as copied',
  async (_what, arrange) => {
    const { user } = await openCredentials();
    arrange();
    await user.click(copyButton('GITHUB_APP_ID'));
    await waitFor(() => {
      expect(screen.getByText(messages['setup.item.copyUnavailable'])).toBeInTheDocument();
    });
    expect(screen.queryByText(messages['setup.item.copied'].replace('{name}', 'GITHUB_APP_ID'))).toBeNull();
    expect(screen.getByText(messages['setup.item.copyUnavailable']).closest('[role="status"]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  },
);

test.each(SECRETS)(
  'Download saves %s as a Blob named exactly like the file, with the value as its content',
  async (label, value) => {
    const downloads = stubDownloads();
    const { user } = await openCredentials();
    await user.click(downloadButton(label));
    expect(downloads.saved()).toEqual([{ name: label.replace('secrets/', ''), address: 'blob:made-up-address' }]);
    expect(await downloads.create.mock.calls[0]?.[0].text()).toBe(value);
  },
);

test.each(PUBLIC)(
  'Download saves %s under the name of its variable, as the line of the .env file',
  async (label, value) => {
    const downloads = stubDownloads();
    const { user } = await openCredentials();
    await user.click(downloadButton(label));
    expect(downloads.saved()).toEqual([{ name: label, address: 'blob:made-up-address' }]);
    expect(await downloads.create.mock.calls[0]?.[0].text()).toBe(`${label}=${value}\n`);
  },
);

// Each download revokes its address one second later, and a timer of an earlier test fires into the stub of a later one, so the
// stub's calls are not only this download's: this one has an address of its own, and what counts is the calls with that address.
test('the object URL of a download is revoked afterwards', async () => {
  const address = 'blob:made-up-address-of-the-revoked-download';
  const downloads = stubDownloads();
  downloads.create.mockReturnValue(address);
  const { user } = await openCredentials();
  await user.click(downloadButton('secrets/github_webhook_secret'));
  await waitFor(
    () => {
      expect(downloads.revoke.mock.calls.filter(([revoked]) => revoked === address)).toHaveLength(1);
    },
    { timeout: 3000 },
  );
});

test('the next steps: save the three files, put the two values into .env, restart, install on each organisation', async () => {
  await openCredentials();
  const steps = [...(screen.getByText(messages['setup.next.save']).closest('ol')?.querySelectorAll('li') ?? [])];
  expect(steps).toHaveLength(4);
  expect(steps[0]).toHaveTextContent(messages['setup.next.save']);
  expect(steps[1]).toHaveTextContent(messages['setup.next.env']);
  expect(steps[2]).toHaveTextContent(messages['setup.next.restart']);
  expect(steps[3]).toHaveTextContent(messages['setup.next.install']);
  expect(messages['setup.next.restart']).toContain('docker compose up -d');
  expect(screen.getByRole('heading', { level: 2, name: messages['setup.next.title'] })).toBeInTheDocument();
});

test('the install link is built from the slug on github.com and opens safely; the App page link is the htmlUrl', async () => {
  await openCredentials();
  const install = screen.getByRole('link', { name: messages['setup.next.installLink'] });
  expect(install).toHaveAttribute('href', 'https://github.com/apps/cla-gate-test/installations/new');
  expect(install).toHaveAttribute('rel', 'noopener noreferrer');
  expect(install).toHaveAttribute('target', '_blank');
  const page = screen.getByRole('link', { name: messages['setup.credentials.appPage'] });
  expect(page).toHaveAttribute('href', CONVERTED.htmlUrl);
  expect(page).toHaveAttribute('rel', 'noopener noreferrer');
});

test('the install link ignores the install address the server sent, even a perfectly good one', async () => {
  await openCredentials({
    convert: json({ ...CONVERTED, installUrl: 'https://github.com/apps/someone-else/installations/new' }),
  });
  const install = screen.getByRole('link', { name: messages['setup.next.installLink'] });
  expect(install).toHaveAttribute('href', 'https://github.com/apps/cla-gate-test/installations/new');
});

test('everything is reachable and operable by keyboard: Tab through the fields and buttons, Enter and Space act', async () => {
  const { user } = await openCredentials();
  const copy = copyButton('secrets/github_client_secret');
  const reveal = revealButton('secrets/github_client_secret');
  reveal.focus();
  await user.keyboard(' ');
  expect(field('secrets/github_client_secret')).toHaveValue(CONVERTED.clientSecret);
  await user.tab();
  expect(copy).toHaveFocus();
  const write = vi.spyOn(navigator.clipboard, 'writeText');
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenCalledExactlyOnceWith(CONVERTED.clientSecret);
  await user.tab();
  expect(downloadButton('secrets/github_client_secret')).toHaveFocus();
  const visited = new Set<Element | null>();
  for (let presses = 0; presses < 40; presses += 1) {
    await user.tab();
    visited.add(document.activeElement);
  }
  for (const label of [...PUBLIC, ...SECRETS].map(([name]) => name)) {
    expect(visited.has(field(label)), label).toBe(true);
  }
});

test('the screen passes axe, masked and revealed', async () => {
  const { container, user } = await openCredentials();
  await expectNoA11yViolations(container);
  for (const [label] of SECRETS) {
    await user.click(revealButton(label));
  }
  await user.click(copyButton('GITHUB_APP_ID'));
  await expectNoA11yViolations(container);
});
