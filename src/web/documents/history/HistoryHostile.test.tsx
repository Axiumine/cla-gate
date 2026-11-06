// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { HOSTILE_CLA_ROWS } from '../../../shared/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { activeContent } from '../../test-support/hostile.ts';
import { visibleText } from '../../ui/user-text.ts';
import {
  comparison,
  diffList,
  historyVersion,
  openHistory,
  rowOf,
  V1_0,
  V1_1,
  viewButton,
  viewer,
} from './test-support.ts';

// E18-S11: a rationale, a login and a CLA text are text that people chose. They are drawn as text in the history, in the viewer and in
// the diff, and nowhere as markup.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);

/** Elements and attributes that a reader's browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed, form';

test.each(NAMES)(
  'the rationale and the login %s are text in the list, with the hidden characters written out',
  async (_label, name) => {
    await openHistory({
      history: {
        versions: [historyVersion(), { ...V1_1, rationale: name, publishedBy: { githubId: 4712, login: name } }, V1_0],
      },
    });
    const cells = rowOf('1.1').querySelectorAll('td');
    expect(cells[2]?.textContent).toBe(`${visibleText(name)} ${messages['history.publishedBy.id']} 4712`);
    const rationale = cells[3]?.querySelector('.sr-only') ?? cells[3]?.querySelector('bdi');
    expect(rationale?.textContent).toBe(visibleText(name));
    expect(cells[2]?.querySelector('bdi')?.textContent).toBe(visibleText(name));
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
    expect(screen.getByRole('main').querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)('the rationale and the login %s are text in the viewer too', async (_label, name) => {
  const { user } = await openHistory({
    history: {
      versions: [historyVersion(), { ...V1_1, rationale: name, publishedBy: { githubId: 4712, login: name } }, V1_0],
    },
  });
  await user.click(viewButton('1.1'));
  const region = await viewer('1.1');
  const facts = region.querySelector('dl');
  expect(facts?.textContent).toContain(visibleText(name));
  expect(activeContent(region)).toEqual([]);
  expect(region.querySelectorAll(ACTIVE)).toHaveLength(0);
});

test.each(HOSTILE_CLA_ROWS)(
  'hostile CLA text, %s: the viewer keeps it inert and the text of what was refused stays readable',
  async (_label, source, shown) => {
    const { user } = await openHistory({
      history: { versions: [historyVersion(), { ...V1_1, contentMd: source }, V1_0] },
    });
    await user.click(viewButton('1.1'));
    const region = await viewer('1.1');
    expect(activeContent(region)).toEqual([]);
    expect(region.querySelectorAll(ACTIVE)).toHaveLength(0);
    expect(region.querySelectorAll('script, img')).toHaveLength(0);
    expect(region.textContent).toContain(shown);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  },
);

test.each(HOSTILE_CLA_ROWS)(
  'hostile CLA text, %s: every line of it is a line of text in the diff, as it was written',
  async (_label, source) => {
    await openHistory({
      route: '/installations/5/documents/11?tab=history&compare=true',
      history: {
        versions: [historyVersion({ contentMd: `${source}\n` }), { ...V1_1, contentMd: 'Zzzz base\n' }, V1_0],
      },
    });
    const list = await diffList('1.1', '2.0');
    const added = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('.sr-only')?.textContent === messages['history.diff.added'])
      .map((item) => item.lastElementChild?.textContent);
    expect(added).toEqual(source.split('\n').map(visibleText));
    expect(activeContent(list)).toEqual([]);
    expect(list.querySelectorAll(`${ACTIVE}, a, script, img`)).toHaveLength(0);
  },
);

test('a text with the whole table of hostile rows at once is inert in the viewer and in the diff, and both pass axe', async () => {
  const everything = HOSTILE_CLA_ROWS.map(([, source]) => source).join('\n\n');
  const { user, container } = await openHistory({
    history: { versions: [historyVersion({ contentMd: everything }), V1_1, V1_0] },
  });
  await user.click(viewButton('2.0'));
  const region = await viewer('2.0');
  expect(activeContent(region)).toEqual([]);
  await expectNoA11yViolations(container);
  await user.click(screen.getByRole('button', { name: messages['history.compare'] }));
  await comparison();
  const list = await diffList('1.1', '2.0');
  expect(activeContent(list)).toEqual([]);
  expect(list.querySelectorAll('a, script, img')).toHaveLength(0);
  await expectNoA11yViolations(container);
});
