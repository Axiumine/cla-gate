// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import axe, { type Result, type RunOptions } from 'axe-core';
import { expect } from 'vitest';

// The accessibility check of the web tests (E17-S06), built on axe-core (MPL-2.0, a dev dependency: nothing of it ships
// to the browser). Every component test calls it on what it rendered.

/**
 * The rules axe runs with. `color-contrast` is off because jsdom does no layout and no cascade of the stylesheet, so axe
 * cannot compute a colour: contrast is checked on the tokens instead (src/web/theme/contrast.test.ts, E17-S05). `region` is
 * off because a component is rendered as a fragment, and a fragment has no landmarks around it; the landmarks of the whole
 * page are asserted by the tests of the shell (E17-S09).
 */
const OPTIONS: RunOptions = {
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  resultTypes: ['violations'],
};

/** One violation as a line a failing test prints: the rule, what it asks for, and the elements that break it. */
function describeViolation(violation: Result): string {
  const targets = violation.nodes.map((node) => node.target.join(' ')).join(', ');
  return `${violation.id}: ${violation.help} [${targets}]`;
}

/** The rules of axe that `container` breaks, as readable lines; an empty list means none. */
export async function a11yViolations(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, OPTIONS);
  return results.violations.map(describeViolation);
}

/** Fails the test, naming each rule and element, when axe finds an accessibility violation in `container`. */
export async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  const violations = await a11yViolations(container);
  expect(violations, `axe found ${violations.length.toString()} violation(s):\n${violations.join('\n')}`).toEqual([]);
}
