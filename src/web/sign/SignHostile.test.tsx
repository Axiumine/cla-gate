// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { signerInputSchema } from '../../shared/signer-input.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import { SignView } from './SignView.tsx';
import { consentBox, contextOf, nameInput, serveSign, signButton } from './test-support.ts';

// E18-S01: every name of the shared hostile corpus (E09-S01), as the document name, the repository, the rationale of the
// version and the name the signer types, renders as text in the form, in the confirmation and in the h1.

/** The sign page for a person who must sign again, with `name` in every slot that shows text a person controls. */
function viewWith(name: string) {
  const base = contextOf();
  return contextOf({
    state: 'resign_required',
    signature: { id: 5, major: 1, minor: 0, signedAt: '2026-01-01T00:00:00.000Z' },
    document: { id: 7, name },
    repository: { githubRepoId: 123, fullName: name, accountLogin: 'acme' },
    version: { ...base.version, rationale: name },
  });
}

test.each(HOSTILE_NAMES)(
  'the hostile name %j is inert in the h1, the details, the form and the confirmation',
  async (name) => {
    serveSign();
    const { user, container } = renderWithProviders(<SignView context={viewWith(name)} />, { session: ALICE });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(name);
    expect(container.textContent.split(name).length).toBeGreaterThanOrEqual(4);
    expect(activeContent(container)).toEqual([]);

    await user.click(consentBox());
    await user.click(nameInput());
    await user.paste(name);
    expect(nameInput()).toHaveValue(name);
    expect(activeContent(container)).toEqual([]);

    await user.click(signButton());
    await screen.findByRole('heading', { level: 2, name: messages['sign.done.title'] });
    const typed = signerInputSchema.shape.name.parse(name);
    expect(container.textContent).toContain(typed);
    expect(activeContent(container)).toEqual([]);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  },
);

test('the sign page with a hostile document name and typed name passes axe', async () => {
  serveSign();
  const name = '<img src=x onerror=alert(1)>';
  const { user, container } = renderWithProviders(<SignView context={viewWith(name)} />, { session: ALICE });
  await expectNoA11yViolations(container);
  await user.click(consentBox());
  await user.click(nameInput());
  await user.paste(name);
  await user.click(signButton());
  await screen.findByRole('heading', { level: 2, name: messages['sign.done.title'] });
  await expectNoA11yViolations(container);
});
