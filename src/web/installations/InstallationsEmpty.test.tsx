// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, test } from 'vitest';
import { metaRoute } from '../../shared/meta.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { server } from '../test-support/server.ts';
import { META_WITH_APP, noInstallations, renderInstallations, serveTenants } from './test-support.ts';

// E18-S04: the person administers no installation. The empty state says how to install the App, and the link is the one the
// instance names in GET /api/meta.

const serveNone = () => serveTenants([], noInstallations);
const empty = () => screen.findByRole('heading', { level: 2, name: messages['installations.empty.title'] });

test("with an App to install the empty state explains it and links to GitHub's page, which opens in a new tab with no opener", async () => {
  serveNone();
  renderInstallations('/installations', META_WITH_APP);
  await empty();
  expect(screen.getByText(messages['installations.empty.description'])).toBeInTheDocument();
  const link = await screen.findByRole('link', { name: messages['installations.empty.install'] });
  expect(link).toHaveAttribute('href', 'https://github.com/apps/cla-gate/installations/new');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByText(messages['installations.empty.setup'])).toBeNull();
});

test('without an App (installUrl is null) it tells the operator to finish the first-run setup, with a link to it', async () => {
  serveNone();
  renderInstallations('/installations');
  expect(await screen.findByText(messages['installations.empty.setup'])).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['installations.empty.setupLink'] })).toHaveAttribute(
    'href',
    '/setup',
  );
  expect(screen.queryByRole('link', { name: messages['installations.empty.install'] })).toBeNull();
});

test('when the meta endpoint cannot be read the explanation stands with no link and no claim about the setup', async () => {
  serveNone();
  renderInstallations('/installations');
  server.use(http.get(metaRoute.path, () => HttpResponse.error()));
  await empty();
  expect(screen.getByText(messages['installations.empty.description'])).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: messages['installations.empty.install'] })).toBeNull();
  expect(screen.queryByText(messages['installations.empty.setup'])).toBeNull();
});

test("the empty state shows the page's one h1 and passes axe", async () => {
  serveNone();
  const { container } = renderInstallations('/installations', META_WITH_APP);
  await screen.findByRole('link', { name: messages['installations.empty.install'] });
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  await expectNoA11yViolations(container);
});
