// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { activeContent } from '../../test-support/hostile.ts';
import { visibleText } from '../../ui/user-text.ts';
import { detailOf, listedOf, versionOf } from '../test-support.ts';
import { openQuestion, question } from './test-support.ts';

// E18-S14: the name of a document is text a person controls. It is drawn as text in the title of the invalidation question, the hidden
// characters written out, and it is not in the name of the button that opens it.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** The default document with `name` as its name; the active version is the newest of the history (2.0). */
const documentNamed = (name: string) =>
  detailOf(
    listedOf({
      name,
      activeVersion: versionOf({
        id: 303,
        major: 2,
        minor: 0,
        contentSha256: 'c'.repeat(64),
        publishedAt: '2026-10-05T10:00:00.000Z',
      }),
    }),
  );

test.each(NAMES)(
  'the document %s is text in the title of the question, as written, and not in the name of the button',
  async (_label, name) => {
    await openQuestion({ serve: { detail: [documentNamed(name)] } });
    const dialog = question();
    expect(dialog.textContent).toContain(visibleText(name));
    expect(activeContent(dialog)).toEqual([]);
    expect(dialog.querySelectorAll(ACTIVE)).toHaveLength(0);
    const buttons = screen.getAllByRole('button', { hidden: true, name: /^Invalidate signatures of version/ });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      messages['invalidate.action.label'].replace('{major}', '2'),
      messages['invalidate.action.label'].replace('{major}', '1'),
    ]);
  },
);

test('a hostile document name leaves the question without an accessibility violation', async () => {
  await openQuestion({ serve: { detail: [documentNamed(HOSTILE_NAMES[0] ?? 'x')] } });
  await expectNoA11yViolations(question());
});
