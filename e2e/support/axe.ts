// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { expect } from './test.ts';

// E18-S12: axe-core (MPL-2.0, a dev dependency, already the engine of the unit tests) run in the real browser, where the rule that
// jsdom cannot check, `color-contrast`, works: it needs the layout and the cascade of the stylesheet.

const require = createRequire(import.meta.url);

/**
 * The library as text. It is handed to the page through the protocol (`page.evaluate`), which the policy of the page does not
 * restrict, so no script is injected into the page and the pass cannot be blocked, or be counted as a violation, by the policy.
 */
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the one require.resolve gives for the library of this repository
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** Every rule on its default, and the contrast rule named, so that turning it off needs a change in this file. */
const OPTIONS = { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: true } } };

const violationsSchema = z.array(
  z.object({
    id: z.string(),
    help: z.string(),
    nodes: z.array(z.object({ target: z.array(z.unknown()), failureSummary: z.string().optional() })),
  }),
);

/** One violation as a line of the report: the rule, what it asks for, and the elements that break it. */
function describe(violation: z.infer<typeof violationsSchema>[number]): string {
  const nodes = violation.nodes.map((node) =>
    `    ${node.target.map(String).join(' ')}: ${node.failureSummary ?? ''}`.trim(),
  );
  return [`${violation.id}: ${violation.help}`, ...nodes].join('\n');
}

/**
 * Fails when axe finds a violation on the page as it is now, listing the rule, the node and the route.
 * @param page the page, with its screen loaded.
 * @param route the address the page was opened at, for the report.
 */
export async function expectNoAxeViolations(page: Page, route: string): Promise<void> {
  await page.evaluate(AXE_SOURCE);
  const found: unknown = await page.evaluate(
    `axe.run(document, ${JSON.stringify(OPTIONS)}).then((results) => results.violations)`,
  );
  const lines = violationsSchema.parse(found).map(describe);
  expect(lines, `axe found ${String(lines.length)} violation(s) on ${route}:\n${lines.join('\n')}`).toEqual([]);
}
