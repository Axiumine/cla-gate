// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import { EmployerClaim } from './EmployerClaim.tsx';
import { answerAvailability, availabilitySettled, REPO_ID } from './test-support.ts';

// E21-S04: the entry "Contributing for an employer?" as the page where a contributor signs embeds it: there only when the repository offers it.

test('the entry is shown when the repository offers the claim', async () => {
  answerAvailability(true);
  renderWithProviders(<EmployerClaim githubRepoId={REPO_ID} />, { session: ALICE });
  expect(await screen.findByRole('heading', { name: messages['corporate.claim.title'] })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: messages['corporate.claim.submit'] })).toBeInTheDocument();
});

test.each([
  ['it does not', false],
  ['asking fails', { status: 500, code: 'internal_server_error' }],
] as const)('no trace of the entry is shown when the repository %s offer it', async (_why, answer) => {
  answerAvailability(answer);
  const { container, queryClient } = renderWithProviders(<EmployerClaim githubRepoId={REPO_ID} />, { session: ALICE });
  await availabilitySettled(queryClient);
  expect(container).toBeEmptyDOMElement();
});
