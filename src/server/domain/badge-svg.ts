// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The three badges of the public routes (E22-S03), as fixed templates. Every byte of an image is written here, at the time the module
// loads, from the literals below: nothing a request carries (a login, a repository id, a header) is ever interpolated, so two
// requests with the same verdict get the same bytes and no request can put markup into an image. The widths are those of the text
// in the font the image names, with a little room at each side; the colours keep a contrast of at least 4.5 to 1 with the white text.

/** What a badge says: the project asks for a signature, or a signer has one, or has none. */
export type BadgeKind = 'required' | 'signed' | 'not_signed';

/** The part of a badge that tells what it is about, the same on all three. */
const LABEL = { text: 'CLA', width: 34, fill: '#24292f' } as const;

/** The font of the text: a stack that every system has one of, at a size that fits the height of the image. */
const FONT = 'Verdana,Geneva,DejaVu Sans,sans-serif';

const HEIGHT = 20;

/** The part of a badge that carries the verdict. */
interface Value {
  readonly text: string;
  readonly width: number;
  readonly fill: string;
}

/** The whole image from the label and one value; called three times, with literals. */
function badge(value: Value): string {
  const width = LABEL.width + value.width;
  const title = `${LABEL.text}: ${value.text}`;
  const labelX = LABEL.width / 2;
  const valueX = LABEL.width + value.width / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<clipPath id="c"><rect width="${width}" height="${HEIGHT}" rx="3"/></clipPath>`,
    `<g clip-path="url(#c)"><rect width="${LABEL.width}" height="${HEIGHT}" fill="${LABEL.fill}"/>`,
    `<rect x="${LABEL.width}" width="${value.width}" height="${HEIGHT}" fill="${value.fill}"/></g>`,
    `<g fill="#fff" text-anchor="middle" font-family="${FONT}" font-size="11">`,
    `<text x="${labelX}" y="14">${LABEL.text}</text><text x="${valueX}" y="14">${value.text}</text></g>`,
    '</svg>\n',
  ].join('');
}

/** "CLA | required": the project asks contributors to sign. Blue, because it is a fact about the project and no verdict on anyone. */
const REQUIRED = badge({ text: 'required', width: 58, fill: '#0969da' });

/** "CLA | signed": green. */
const SIGNED = badge({ text: 'signed', width: 48, fill: '#1a7f37' });

/** "CLA | not signed": grey, the colour of a state and not of a fault. */
const NOT_SIGNED = badge({ text: 'not signed', width: 70, fill: '#6e7781' });

/**
 * The image of a badge, as the bytes the route sends. The result is one of three constants; `kind` is the only input, and it is
 * the verdict the route reached, never a value of the request.
 */
export function badgeSvg(kind: BadgeKind): string {
  switch (kind) {
    case 'required':
      return REQUIRED;
    case 'signed':
      return SIGNED;
    case 'not_signed':
      return NOT_SIGNED;
  }
}
