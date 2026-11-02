// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import { hexColour as hex } from '../test-support/colour-literals.ts';
import {
  BOUNDARY_MINIMUM,
  contrastFailures,
  contrastRatio,
  type Pair,
  TEXT_MINIMUM,
} from '../test-support/contrast.ts';
import { colourTokens, themeTokens } from '../test-support/css.ts';

// E17-S05: WCAG 2.2 contrast of the declared foreground/background pairs of tokens.css, in both themes: 4.5:1 for text
// (1.4.3), 3:1 for the boundaries of controls and the focus ring (1.4.11). A new colour token has to join a pair below, or
// the last test fails: a palette change cannot slip a colour in that nothing checks.

const compare = (a: string, b: string): number => a.localeCompare(b);

const SURFACES = ['--page', '--surface', '--surface-muted'];
const STATUSES = ['success', 'warning', 'danger', 'info'];

const text = (foreground: string, background: string): Pair => ({ foreground, background, minimum: TEXT_MINIMUM });
const boundary = (foreground: string, background: string): Pair => ({
  foreground,
  background,
  minimum: BOUNDARY_MINIMUM,
});

/** Text on the page and on every surface, links included. */
const BODY_TEXT = ['--fg', '--fg-muted', '--link'].flatMap((token) => SURFACES.map((surface) => text(token, surface)));

/** The label of a filled button on its fill, at rest and on hover. */
const ACTION_LABELS = [
  text('--on-accent', '--accent'),
  text('--on-accent', '--accent-hover'),
  text('--on-danger', '--danger'),
  text('--on-danger', '--danger-hover'),
];

/** A status message or badge: its text on its tint, and on the page and the card it can also stand on. */
const STATUS_TEXT = STATUSES.flatMap((status) => [
  text(`--${status}-fg`, `--${status}-bg`),
  text(`--${status}-fg`, '--page'),
  text(`--${status}-fg`, '--surface'),
]);

/** What shows where a control or a card ends: the border, the focus ring and the fill of a button against what it sits on. */
const BOUNDARIES = [
  ...['--line', '--focus'].flatMap((token) => SURFACES.map((surface) => boundary(token, surface))),
  ...['--accent', '--danger'].flatMap((token) => ['--page', '--surface'].map((surface) => boundary(token, surface))),
];

const TEXT_PAIRS: readonly Pair[] = [...BODY_TEXT, ...ACTION_LABELS, ...STATUS_TEXT];
const PAIRS: readonly Pair[] = [...TEXT_PAIRS, ...BOUNDARIES];

const tokens = themeTokens(tokensCss);
const THEMES = [
  ['light', colourTokens(tokens.light)],
  ['dark', colourTokens(tokens.dark)],
] as const;

test.each(
  THEMES.flatMap(([theme, colours]) =>
    PAIRS.map((pair) => {
      const kind = pair.minimum === TEXT_MINIMUM ? 'text' : 'boundary';
      const ratio = contrastRatio(
        colours.get(pair.foreground) ?? hex('000000'),
        colours.get(pair.background) ?? hex('000000'),
      );
      return [`${theme} theme, ${kind}: ${pair.foreground} on ${pair.background}`, ratio, pair.minimum] as const;
    }),
  ),
)('%s is %f:1, at least %f:1', (_what, ratio, minimum) => {
  expect(ratio).toBeGreaterThanOrEqual(minimum);
});

test.each(THEMES)(
  '%s theme: no declared pair is below its minimum, and every token of a pair has a colour',
  (_theme, colours) => {
    expect(contrastFailures(colours, PAIRS)).toEqual([]);
  },
);

test('the pairs cover text at 4.5:1 and boundaries and the focus ring at 3:1, and no other threshold', () => {
  expect(new Set(PAIRS.map((pair) => pair.minimum))).toEqual(new Set([4.5, 3]));
  expect(PAIRS.filter((pair) => pair.foreground === '--focus' && pair.minimum === 3)).toHaveLength(SURFACES.length);
});

test('every colour token of the light theme is redefined for dark, and dark defines no colour that light lacks', () => {
  const light = [...colourTokens(tokens.light).keys()].sort(compare);
  expect([...colourTokens(tokens.darkOverrides).keys()].sort(compare)).toEqual(light);
  expect(light.length).toBeGreaterThan(0);
});

test('the dark theme is a different palette: the page, the surfaces and the text change', () => {
  for (const token of ['--page', '--surface', '--surface-muted', '--fg', '--fg-muted', '--link']) {
    expect(tokens.dark.get(token)).not.toBe(tokens.light.get(token));
  }
});

test('every colour token is in at least one declared pair, so a new colour cannot go unchecked', () => {
  const used = new Set(PAIRS.flatMap((pair) => [pair.foreground, pair.background]));
  expect([...colourTokens(tokens.light).keys()].filter((token) => !used.has(token))).toEqual([]);
});

test('a palette that fails would be caught: the same pairs on a washed-out copy of the light theme fail', () => {
  const washedOut = new Map(colourTokens(tokens.light));
  washedOut.set('--fg', hex('999999'));
  washedOut.set('--line', hex('dddddd'));
  const failures = contrastFailures(washedOut, PAIRS);
  expect(failures.some((failure) => /^--fg on --page: \d\.\d\d:1 is below 4\.5:1$/.test(failure))).toBe(true);
  expect(failures.some((failure) => failure.startsWith('--line on --surface:'))).toBe(true);
});
