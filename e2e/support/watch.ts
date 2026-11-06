// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Page } from '@playwright/test';
import { isExpectedRefusal, type Refusal } from '../../scripts/e2e/console-rules.ts';

// E18-S12: what a page must never do during a spec: log a console error, throw an uncaught error, open a dialog (a hostile text
// that ran would), or break its Content-Security-Policy. The page reports each of these to this watcher, and the spec fails with
// the list when it is not empty at the end.

const BINDING = '__claReportViolation';

/**
 * The page side of the watch, as text: Playwright runs it before any script of the page, through the protocol, so the policy
 * of the page does not apply to it. Every `securitypolicyviolation` event of the document is sent to the binding, and the
 * binding is a function of this process, so a navigation does not lose what happened before it.
 */
const VIOLATION_LISTENER = `
  document.addEventListener(
    'securitypolicyviolation',
    (event) => window.${BINDING}(event.violatedDirective + ' blocked ' + event.blockedURI),
    true,
  );
`;

export interface PageWatch {
  /** What went wrong so far, one line each; empty when the page behaved. */
  readonly problems: () => readonly string[];
}

/**
 * Starts watching `page`: call it before the first navigation, or the violations of that page are not seen.
 * @param page the page to watch.
 * @param allowed the answers of the server the page is expected to get and handle (and the browser logs as console errors).
 */
export async function watchPage(page: Page, allowed: readonly Refusal[]): Promise<PageWatch> {
  const problems: string[] = [];
  await page.exposeFunction(BINDING, (line: string) => {
    problems.push(`securitypolicyviolation: ${line}`);
  });
  await page.addInitScript(VIOLATION_LISTENER);
  page.on('console', (message) => {
    const { url } = message.location();
    if (message.type() === 'error' && !isExpectedRefusal(message.text(), url, allowed)) {
      problems.push(`console error: ${message.text()} (${url})`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`uncaught error: ${error.message}`);
  });
  page.on('dialog', (dialog) => {
    problems.push(`${dialog.type()} dialog opened: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return { problems: () => problems };
}
