// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The Trivy supply-chain incident of March 2026 (E20-S02): three Trivy releases were malicious, and every `trivy-action`
 * tag up to 0.34.2 was repointed. These helpers find a mention of either in the text of a file, so a test can fail on
 * any file of the repository that would install or call them.
 */

export type Version = readonly [number, number, number];

/** The last `trivy-action` tag that was repointed. */
export const LAST_COMPROMISED_ACTION: Version = [0, 34, 2];

/** The malicious Trivy releases, all of the form 0.69.x. */
const COMPROMISED_PATCHES: readonly number[] = [4, 5, 6];

/** Runs of digits and dots that start with a digit: a `v` or any other letter ends one, so `v0.34.2` and `trivy_0.69.4_Linux` both yield a number. */
const DOTTED = /\d[\d.]*/g;

/** The numbers of `1.2.3` or `1.2` (a missing patch is 0); undefined for anything else, empty parts included. */
function numbersOf(dotted: string): Version | undefined {
  const parts = dotted.split('.');
  if (parts.length < 2 || parts.length > 3 || parts.includes('')) {
    return undefined;
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2] ?? 0)];
}

/** Parses `1.2.3`, `v1.2.3` or `1.2`; undefined for anything else (a range, a suffix, a fourth number, `latest`). */
export function parseVersion(text: string): Version | undefined {
  const bare = text.startsWith('v') ? text.slice(1) : text;
  return /^[\d.]+$/.test(bare) ? numbersOf(bare) : undefined;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** A sentence's full stop after a number is not part of it. */
function withoutTrailingDots(text: string): string {
  return text.endsWith('.') ? withoutTrailingDots(text.slice(0, -1)) : text;
}

/** Every complete dotted number in a line, as text and as numbers. */
function dottedNumbers(line: string): { text: string; version: Version | undefined }[] {
  return [...line.matchAll(DOTTED)].map((match) => {
    const text = withoutTrailingDots(match[0]);
    return { text, version: numbersOf(text) };
  });
}

function isMaliciousTrivy(text: string, version: Version | undefined): boolean {
  return (
    version !== undefined &&
    text.split('.').length === 3 &&
    version[0] === 0 &&
    version[1] === 69 &&
    COMPROMISED_PATCHES.includes(version[2])
  );
}

/**
 * Every line of `text` that mentions a compromised release, as `line <n>: <reason>`: Trivy 0.69.4, 0.69.5 or 0.69.6
 * anywhere, and any version up to 0.34.2 on a line that names `trivy-action` (the tag after the `@` or in the comment
 * that follows a pinned commit SHA).
 */
export function compromisedReferences(text: string): string[] {
  return text.split('\n').flatMap((line, index) => {
    const numbers = dottedNumbers(line);
    const found: string[] = [];
    if (numbers.some((number) => isMaliciousTrivy(number.text, number.version))) {
      found.push(`line ${index + 1}: names a malicious Trivy release (0.69.4 to 0.69.6)`);
    }
    const repointed = numbers.some(
      (number) => number.version !== undefined && compareVersions(number.version, LAST_COMPROMISED_ACTION) <= 0,
    );
    if (line.toLowerCase().includes('trivy-action') && repointed) {
      found.push(`line ${index + 1}: names a trivy-action tag up to 0.34.2, which was repointed`);
    }
    return found;
  });
}
