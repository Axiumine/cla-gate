// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type BadgeKind, badgeSvg } from './badge-svg.ts';

// The three badges of E22-S03 (the routes that send them are tested in public-badge-routes*.test.ts): the bytes are pinned in files, so
// a change of a colour, a width or a word shows in the diff of the review, and the properties that matter are checked on the bytes.

const KINDS: readonly (readonly [BadgeKind, string])[] = [
  ['required', 'CLA: required'],
  ['signed', 'CLA: signed'],
  ['not_signed', 'CLA: not signed'],
];

test.each(KINDS)('the badge %s is the bytes of its file', async (kind) => {
  await expect(badgeSvg(kind)).toMatchFileSnapshot(`badge-snapshots/${kind}.svg`);
});

test.each(KINDS)(
  'the badge %s says its words in the title and the label, for a screen reader and for a browser that cannot draw it',
  (kind, words) => {
    const svg = badgeSvg(kind);
    expect(svg).toContain(`role="img" aria-label="${words}">`);
    expect(svg).toContain(`<title>${words}</title>`);
    const [label, value] = words.split(': ');
    expect(svg).toContain(`>${label}</text><text`);
    expect(svg).toContain(`>${value}</text>`);
  },
);

test.each(KINDS)(
  'the badge %s is one SVG document and holds no script, no style, no link, no image and no address but the namespace',
  (kind) => {
    const svg = badgeSvg(kind);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg.endsWith('</svg>\n')).toBe(true);
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg.match(/https?:/g)).toHaveLength(1);
    for (const forbidden of [
      '<script',
      '<style',
      '<a ',
      '<image',
      '<foreignObject',
      'href',
      ' on',
      'javascript:',
      'data:',
    ]) {
      expect(svg).not.toContain(forbidden);
    }
  },
);

test.each(KINDS)('the badge %s is as wide as its two halves, and the text is centred in each', (kind) => {
  const svg = badgeSvg(kind);
  // In the order written: the image, the clip, the label and the value.
  const widths = [...svg.matchAll(/ width="(\d+)"/g)].map((match) => Number(match[1]));
  const total = widths[0] ?? 0;
  expect(widths).toEqual([total, total, 34, total - 34]);
  // The rectangle of the value starts where the label ends; the two texts follow, each in the middle of its half.
  const starts = [...svg.matchAll(/ x="([\d.]+)"/g)].map((match) => Number(match[1]));
  expect(starts).toEqual([34, 17, 34 + (total - 34) / 2]);
});

/** The contrast of white text on a colour, as the WCAG formula has it. */
function contrastWithWhite(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05);
}

test.each(KINDS)('both halves of the badge %s keep white text readable: a contrast of at least 4.5 to 1', (kind) => {
  const fills = [...badgeSvg(kind).matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1] ?? '');
  expect(fills).toHaveLength(2);
  for (const fill of fills) {
    expect(contrastWithWhite(fill)).toBeGreaterThanOrEqual(4.5);
  }
});

test('the verdicts have colours of their own: signed is green, not signed is grey, and the project is blue', () => {
  expect(badgeSvg('signed')).toContain('fill="#1a7f37"');
  expect(badgeSvg('not_signed')).toContain('fill="#6e7781"');
  expect(badgeSvg('required')).toContain('fill="#0969da"');
});

test('the same kind is the same bytes every time, and the three kinds are three different images', () => {
  expect(badgeSvg('signed')).toBe(badgeSvg('signed'));
  expect(new Set(KINDS.map(([kind]) => badgeSvg(kind))).size).toBe(3);
});
