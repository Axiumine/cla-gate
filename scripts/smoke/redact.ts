// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E19-S08: the logs of a failed smoke run are uploaded as a CI artifact. No service prints a secret (the smoke test asserts it),
// and this is the second lock: every value of the stack's secret files is replaced before a log is written.

const REPLACEMENT = '[redacted]';

/** Shorter values are not secrets worth hiding and would mangle ordinary words (an empty placeholder file is `''`). */
const MIN_LENGTH = 8;

/** `text` with every occurrence of each secret replaced; the longest first, so a URL that holds a password goes as a whole. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((value) => value.length >= MIN_LENGTH)
    .toSorted((a, b) => b.length - a.length)
    .reduce((out, value) => out.replaceAll(value, REPLACEMENT), text);
}
