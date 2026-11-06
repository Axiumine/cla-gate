// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { openList, revoked, serveOnePage, signaturesTable } from './test-support.ts';

// E18-S03: the document name, the account login and the repository of a signature are text a person controls (a maintainer
// names the document, GitHub names the account and the repository), and each of the names of the shared corpus stays text.

/** A revoked signature with `name` in the three slots that hold text a person controls. */
const hostile = (name: string) =>
  revoked({
    document: { id: 7, name },
    installation: { accountLogin: name, accountType: 'Organization', suspended: true },
    source: { repositoryFullName: name, prNumber: 45 },
  });

test.each(HOSTILE_NAMES)(
  'the hostile name %j is inert as the document, the account login and the repository',
  async (name) => {
    serveOnePage(hostile(name));
    await openList();
    // The shell has the avatar of the person, an image of its own: the screen is the main region.
    const page = screen.getByRole('main');
    expect(page.textContent.split(name).length).toBeGreaterThanOrEqual(4);
    expect(activeContent(page)).toEqual([]);
    expect(signaturesTable().querySelectorAll('a')).toHaveLength(1);
    expect(signaturesTable().querySelector('a')).toHaveAttribute('href', '/sign/123');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  },
);

test('a screen with a hostile name in every slot passes axe', async () => {
  serveOnePage(hostile('<img src=x onerror=alert(1)>'));
  const { container } = await openList();
  await expectNoA11yViolations(container);
});

test('a very long name does not widen the screen: the table sits in a box that scrolls and the name breaks anywhere', async () => {
  serveOnePage(hostile('n'.repeat(200)));
  await openList();
  expect(signaturesTable().parentElement).toHaveClass('overflow-x-auto');
  expect(signaturesTable().querySelector('bdi')).toHaveClass('wrap-anywhere');
});
