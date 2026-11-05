// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { createElement } from 'react';
import { CSRF_HEADER } from '../../shared/auth-contract.ts';
import { BADGE_SNIPPET_PATH, PUBLIC_VERIFICATION_PATH } from '../../shared/public-verification.ts';
import { answer, envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';

// The server of the settings screen, as MSW answers for it in the tests of the public badge (E22-S03). All values are made up.

const INSTALLATION = 7;
const REPOSITORY = 42;

/** The address of the settings screen of repository 42 of installation 7. */
export const SETTINGS_ADDRESS = `/installations/${INSTALLATION.toString()}/repositories/${REPOSITORY.toString()}/settings`;

/** The snippet the server builds for repository 42 of a made-up public address. */
export const SNIPPET = {
  markdown:
    '[![CLA: required](https://cla.example.org/api/public/repos/9001/badge.svg)](https://cla.example.org/sign/9001)',
  html: '<a href="https://cla.example.org/sign/9001"><img src="https://cla.example.org/api/public/repos/9001/badge.svg" alt="CLA: required"></a>',
} as const;

const at = (path: string) =>
  path.replace(':installationId', INSTALLATION.toString()).replace(':repositoryId', REPOSITORY.toString());

/** The answer of the snippet call while the opt-in is on. */
export const on = () => json(SNIPPET);
/** The answer of the snippet call while the opt-in is off. */
export const off = () => envelope(409, 'public_verification_disabled');

interface SettingsCalls {
  /** Every request the snippet call received, in order. */
  readonly snippet: Seen[];
  /** Every request the opt-in call received, in order. */
  readonly optIn: Seen[];
}

/**
 * Opens the settings screen of repository 42 as a signed-in person. The snippet call answers `reads` in turn (the last one for
 * any further read), and the opt-in call answers `writes` in turn.
 */
export function openSettings(reads: Response[], writes: Response[] = []) {
  const calls: SettingsCalls = {
    snippet: answer(at(BADGE_SNIPPET_PATH), ...reads),
    optIn: answer(at(PUBLIC_VERIFICATION_PATH), ...writes),
  };
  return { calls, ...renderWithProviders(createElement(AppRouter), { route: SETTINGS_ADDRESS, session: ALICE }) };
}

/** The CSRF header a request carried. */
export const csrfOf = (seen: Seen | undefined) => new Headers(seen?.headers).get(CSRF_HEADER);

const named = (template: string, name: string) => template.replace('{name}', name);

/** The switch of the public badge. */
export const toggle = () => screen.getByRole('checkbox', { name: messages['repository.badge.toggle'] });
/** The "Copy" button of the form called `name` (Markdown or HTML). */
export const copyOf = (name: string) =>
  screen.getByRole('button', { name: named(messages['repository.badge.copyNamed'], name) });
/** The read-only field of the form called `name`. */
export const fieldOf = (name: string) => screen.getByRole('textbox', { name });
