// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Page } from '@playwright/test';
import type { Landmark, Screen, Viewer } from './screens.ts';
import type { OpenPage, Scheme, Visitor } from './test.ts';
import { ALICE, CAROL, DAN, FRANK, type Person } from './world/people.ts';

// E18-S12: opening a screen of e2e/support/screens.ts as its viewer, in a colour scheme, and waiting until it has its data.

const PEOPLE: ReadonlyMap<Viewer, Person | undefined> = new Map<Viewer, Person | undefined>([
  ['alice', ALICE],
  ['carol', CAROL],
  ['dan', DAN],
  ['frank', FRANK],
  ['visitor', undefined],
]);

function visitorOf(screen: Screen, scheme: Scheme): Visitor {
  const person = PEOPLE.get(screen.viewer);
  return {
    scheme,
    ...(person === undefined ? {} : { cookie: person.cookie }),
    ...(screen.refusals === undefined ? {} : { refusals: screen.refusals }),
  };
}

function landmarkOf(page: Page, landmark: Landmark) {
  if ('text' in landmark) {
    return page.getByText(landmark.text, { exact: true });
  }
  return page.getByRole(landmark.role, landmark.name === undefined ? {} : { name: landmark.name, exact: true });
}

/** Opens `screen` for its viewer and returns the page once the screen has drawn what its landmark names and the network is quiet. */
export async function showScreen(openPage: OpenPage, screen: Screen, scheme: Scheme): Promise<Page> {
  const page = await openPage(visitorOf(screen, scheme));
  await page.goto(screen.path);
  await landmarkOf(page, screen.ready).first().waitFor();
  await page.waitForLoadState('networkidle');
  return page;
}
