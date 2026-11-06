// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type APIRequestContext, type APIResponse, test as base } from '@playwright/test';
import { ANONYMOUS_REFUSALS } from '../../scripts/e2e/console-rules.ts';
import { visualSkipReason } from '../../scripts/e2e/container-guards.ts';
import { type OpenPage, withOpenPage } from './open-page.ts';
import { expectQuiet } from './quiet.ts';
import { watchPage } from './watch.ts';

// E20-S06. Every spec imports `test` and `expect` from here, never from @playwright/test (scripts/e2e/specs.test.ts
// enforces it), so the automatic fixture below applies to all of them.
export { expect, type Page } from '@playwright/test';

export type { OpenPage, Scheme, Visitor } from './open-page.ts';

export const test = base.extend<{ visualGuard: undefined; openPage: OpenPage }>({
  // A `.visual.spec.ts` file is skipped, with the reason in the report, anywhere but in the pinned container.
  visualGuard: [
    /* eslint-disable no-empty-pattern -- Playwright reads the fixtures a function needs from an object pattern, even an empty one */
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a function needs from an object pattern, even an empty one
    async ({}, use, testInfo) => {
      const reason = visualSkipReason(testInfo.file, process.env);
      testInfo.skip(reason !== undefined, reason);
      await use(undefined);
    },
    /* eslint-enable no-empty-pattern -- the pattern above is the only one that needs it */
    { auto: true },
  ],
  // E18-S12: every page a spec opens is watched, and the spec fails when the page logged an error, threw, opened a dialog or
  // broke its policy. The default `page` is the visitor with no session; `openPage` opens one for a person, in a context of their own.
  page: async ({ page }, use) => {
    const watch = await watchPage(page, ANONYMOUS_REFUSALS);
    await use(page);
    expectQuiet(watch.problems());
  },
  openPage: async ({ browser, baseURL }, use) => {
    await withOpenPage(browser, baseURL ?? '', use);
  },
});

/** What a spec needs to know about one answer of the server. */
export interface Reply {
  readonly status: number;
  /** Header names are lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** `GET url` against the server under test (relative to the configured base URL), with the body parsed as JSON. */
export async function getJson(request: APIRequestContext, url: string): Promise<Reply> {
  // Playwright's own default for the body type is `any`, which type coverage does not accept.
  const response: APIResponse<unknown> = await request.get(url);
  return { status: response.status(), headers: response.headers(), body: await response.json() };
}
