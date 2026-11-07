// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Whether a label that starts with `xn--` is punycode a registry could hold (E21-S03, E21-S04), pure. The label is decoded by the algorithm
// of RFC 3492 and the result is held to what an internationalised label may be made of: letters, digits and marks, with at least one
// character outside ASCII. A URL parser may keep a label that does not decode as it was typed (`xn--a`), which would store a name nobody can
// own, so the decoding is asked for here and not left to the parser. Nothing is returned of the decoded text: it is a yes or a no. The decoder
// itself is exported for the tests, so that the constants of the RFC are held by the code points of its sample strings and not by a yes or a no.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;
/** More than any position a code point can be inserted at in a label of at most 63 characters, so a larger sum is an overflow. */
const MAX_DELTA = (MAX_CODE_POINT + 1) * 64;
const ASCII_LIMIT = 0x80;

/** What a decoded code point may be: a letter, a digit, a mark or the hyphen. */
const ALLOWED_CODE_POINT = /^[\p{L}\p{N}\p{M}-]$/u;

/** The value of a punycode digit: `a` to `z` and `A` to `Z` are 0 to 25, `0` to `9` are 26 to 35, and anything else (or no character) is -1. */
function digitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30 + 26;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return code - 0x41;
  }
  return code >= 0x61 && code <= 0x7a ? code - 0x61 : -1;
}

/** The bias for the next code point, from the size of the last step and the number of code points decoded so far. */
function adapt(delta: number, points: number, first: boolean): number {
  let rest = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  rest += Math.floor(rest / points);
  let steps = 0;
  while (rest > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
    rest = Math.floor(rest / (BASE - T_MIN));
    steps += BASE;
  }
  return steps + Math.floor(((BASE - T_MIN + 1) * rest) / (rest + SKEW));
}

/** The threshold of the digit at position `k`: the digit that ends a number is below it. */
const thresholdOf = (k: number, bias: number): number => Math.min(Math.max(k - bias, T_MIN), T_MAX);

/** One variable-length number of the encoded text, from `start`: its value and where the next one starts, or `null` when it is no number. */
function readDelta(encoded: string, start: number, bias: number): { delta: number; next: number } | null {
  let delta = 0;
  let weight = 1;
  let index = start;
  for (let k = BASE; ; k += BASE) {
    const digit = digitValue(encoded.charCodeAt(index));
    if (digit < 0) {
      return null;
    }
    index += 1;
    delta += digit * weight;
    const threshold = thresholdOf(k, bias);
    if (digit < threshold) {
      return { delta, next: index };
    }
    weight *= BASE - threshold;
    if (delta > MAX_DELTA) {
      return null;
    }
  }
}

/** The code points before the last hyphen, which stand for themselves, or `null` when one of them is not ASCII. */
function basicCodePoints(encoded: string, delimiter: number): number[] | null {
  const points: number[] = [];
  for (let index = 0; index < delimiter; index += 1) {
    const code = encoded.charCodeAt(index);
    if (code >= ASCII_LIMIT) {
      return null;
    }
    points.push(code);
  }
  return points;
}

/**
 * The code points the encoded text stands for, or `null` when it is not well-formed punycode. A hyphen at the very start is not a delimiter
 * (RFC 3492, section 6.2: the encoded part starts after the last delimiter only when basic code points come before it), so it is read as a
 * digit and the text is refused.
 * @internal Exported for the tests of the RFC vectors (Knip ignores `@internal` exports in production mode).
 */
export function decodePunycode(encoded: string): number[] | null {
  const delimiter = encoded.lastIndexOf('-');
  const points = basicCodePoints(encoded, delimiter);
  if (points === null) {
    return null;
  }
  let n = INITIAL_N;
  let position = 0;
  let bias = INITIAL_BIAS;
  let index = delimiter > 0 ? delimiter + 1 : 0;
  while (index < encoded.length) {
    const read = readDelta(encoded, index, bias);
    if (read === null) {
      return null;
    }
    const length = points.length + 1;
    bias = adapt(read.delta, length, position === 0);
    position += read.delta;
    n += Math.floor(position / length);
    if (n > MAX_CODE_POINT) {
      return null;
    }
    points.splice(position % length, 0, n);
    position = (position % length) + 1;
    index = read.next;
  }
  return points;
}

/**
 * Whether `encoded`, the part of a label after `xn--`, is punycode that decodes to a label made of letters, digits and marks, with at
 * least one character outside ASCII: the decoding of `xn--a` is a control character, and that of `xn--a-` is plain ASCII, and neither is a label.
 */
export function decodesAsPunycode(encoded: string): boolean {
  const points = decodePunycode(encoded);
  if (points === null) {
    return false;
  }
  return (
    points.some((point) => point >= ASCII_LIMIT) &&
    points.every((point) => ALLOWED_CODE_POINT.test(String.fromCodePoint(point)))
  );
}
