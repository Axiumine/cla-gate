// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type APIRequestContext, type APIResponse, test as base } from '@playwright/test';
import { visualSkipReason } from '../../scripts/e2e/container-guards.ts';

// E20-S06. Every spec imports `test` and `expect` from here, never from @playwright/test (scripts/e2e/specs.test.ts
// enforces it), so the automatic fixture below applies to all of them.
export { expect } from '@playwright/test';

export const test = base.extend<{ visualGuard: undefined }>({
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
