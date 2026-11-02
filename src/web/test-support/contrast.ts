// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// WCAG 2.2 contrast (E17-S05, success criterion 1.4.3 for text and 1.4.11 for the boundaries of controls and the focus
// ring), computed from the colours of tokens.css. A test, not a runtime feature: nothing in the app imports this.

/** The least ratio for text of normal size (1.4.3, level AA). */
export const TEXT_MINIMUM = 4.5;
/** The least ratio for a boundary of a control, and for the focus ring (1.4.11, level AA). */
export const BOUNDARY_MINIMUM = 3;

/** One byte of an sRGB colour as a linear light value. 0.04045 is the corrected threshold of WCAG 2.2. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white). Any other spelling is refused. */
export function relativeLuminance(colour: string): number {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(colour);
  if (match === null) {
    throw new Error(`${JSON.stringify(colour)} is not a #rrggbb colour`);
  }
  const [red = 0, green = 0, blue = 0] = match.slice(1).map((byte) => linear(Number.parseInt(byte, 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast ratio of two colours, from 1 (the same) to 21 (black on white), in either order. */
export function contrastRatio(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A foreground token on a background token, and the ratio it has to reach. */
export interface Pair {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
}

/** What is wrong with `pairs` for the colours in `tokens`: a ratio below the minimum, or a token that has no colour. */
export function contrastFailures(tokens: ReadonlyMap<string, string>, pairs: readonly Pair[]): string[] {
  return pairs.flatMap(({ foreground, background, minimum }) => {
    const first = tokens.get(foreground);
    const second = tokens.get(background);
    if (first === undefined || second === undefined) {
      return [`${foreground} on ${background}: a token has no colour`];
    }
    const ratio = contrastRatio(first, second);
    return ratio < minimum
      ? [`${foreground} on ${background}: ${ratio.toFixed(2)}:1 is below ${minimum.toString()}:1`]
      : [];
  });
}
