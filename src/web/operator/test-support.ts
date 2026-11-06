// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { createElement } from 'react';
import type { z } from 'zod';
import { OPERATOR_INSTALLATIONS_PATH, operatorInstallationsResponseSchema } from '../../shared/operator.ts';
import { answer, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';

// The server of the operator screen, as MSW answers for it in the tests of E18-S13: the list of installations of the instance, every
// request recorded. All values are made up. The made-up server of every test answers `404` to the operator endpoint unless the test says
// otherwise (src/web/test-support/server.ts), which is what a person who does not operate the instance gets.

const installationSchema = operatorInstallationsResponseSchema.shape.installations.element;

type InstallationInput = z.input<typeof installationSchema>;

/** The route of the screen. */
export const OPERATOR_ROUTE = '/operator/installations';

/** An organisation that was admitted, is in use and has not been suspended or deleted. */
const ACME: InstallationInput = {
  githubInstallationId: 100001,
  accountId: 4000,
  accountLogin: 'acme',
  accountType: 'Organization',
  admissionStatus: 'admitted',
  admissionReason: null,
  admissionDecidedAt: '2026-10-01T09:00:00.000Z',
  suspendedAt: null,
  deletedAt: null,
  tenantState: 'active',
  repositories: { active: 12, enabled: 3, removed: 1 },
};

/** An installation as the endpoint sends it: `overrides` are put over the organisation `acme` and the contract is checked. */
export function installationOf(overrides: Partial<InstallationInput> = {}): z.output<typeof installationSchema> {
  return installationSchema.parse({ ...ACME, ...overrides });
}

/** An account the instance does not serve: rejected on 2 October 2026, with the reason it stored. */
export const rejectedOf = (overrides: Partial<InstallationInput> = {}) =>
  installationOf({
    githubInstallationId: 100002,
    accountId: 4001,
    accountLogin: 'stranger',
    accountType: 'User',
    admissionStatus: 'rejected',
    admissionReason: 'account_not_allowed',
    admissionDecidedAt: '2026-10-02T10:30:00.000Z',
    tenantState: 'rejected',
    repositories: { active: 0, enabled: 0, removed: 0 },
    ...overrides,
  });

/** The answer of the endpoint for an operator: these installations. */
export const operatorList = (installations: readonly z.output<typeof installationSchema>[]): Response =>
  json(operatorInstallationsResponseSchema.parse({ installations }));

/** Answers the endpoint with `responses` in turn (the last one again), and returns the requests it received. */
export const serveOperator = (...responses: Response[]): Seen[] => answer(OPERATOR_INSTALLATIONS_PATH, ...responses);

/** The app at `route`, signed in as the test user. */
export function renderOperator(route: string = OPERATOR_ROUTE) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

/** The table of installations, once it is there. */
export const operatorTable = () => screen.findByRole('table', { name: messages['operator.caption'] });

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  [...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

/** The "Operator" link of the user menu, once it is there. */
export const operatorLink = () => screen.findByRole('link', { name: messages['operator.link'] });
