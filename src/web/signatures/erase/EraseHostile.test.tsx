// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { activeContent } from '../../test-support/hostile.ts';
import { visibleText } from '../../ui/user-text.ts';
import { openSignatures, pageOf, SIGNATURES_ROUTE, signatureOf, signaturesTable } from '../test-support.ts';
import { serveErase } from './test-support.ts';

// E18-S14: the name a signer typed is text a person controls. It is drawn as text in the title of the erasure question and in the name of
// the button that opens it, the hidden characters written out, and nowhere as markup.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** Ada's signature, with `name` as the name the signer typed and as their login. */
const hostileOf = (name: string) => signatureOf({ signer: { login: name, name, email: name } });

/** The signatures of one hostile signer, and the button of their row. */
async function openHostile(name: string) {
  serveErase();
  const opened = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([hostileOf(name)])] });
  const button = within(signaturesTable()).getByRole('button', { name: /^Erase personal data of/ });
  return { ...opened, button };
}

test.each(NAMES)(
  'the signer %s is text in the title of the question and in the name of the button',
  async (_label, name) => {
    const { button, user } = await openHostile(name);
    expect(button.getAttribute('aria-label')).toBe(
      messages['erase.action.label'].replace('{signer}', visibleText(name)),
    );
    expect(activeContent(signaturesTable())).toEqual([]);
    await user.click(button);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(visibleText(name));
    expect(activeContent(dialog)).toEqual([]);
    expect(dialog.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test('a hostile signer name leaves the question without an accessibility violation', async () => {
  const { button, user } = await openHostile(HOSTILE_NAMES[0] ?? 'x');
  await user.click(button);
  await expectNoA11yViolations(await screen.findByRole('alertdialog'));
});
