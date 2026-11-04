// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E19-S08: the .env of a smoke stack. scripts/init-secrets.sh copies .env.example; the smoke test sets what only it knows (the
// random port, the origin, the network) and leaves every other line, comments included, as the operator would have it.

const ASSIGNMENT = /^([A-Z][A-Z0-9_]*)=/;

/**
 * `dotenv` with each setting applied: every `NAME=...` line of a name is replaced in place (compose reads the last one, so a
 * repeated name must not keep an old value) and a name that has none is added at the end. Values are written as they are, with
 * no quoting: the caller passes origins, ports and subnets only.
 */
export function withSettings(dotenv: string, settings: Readonly<Record<string, string>>): string {
  const wanted = new Map(Object.entries(settings));
  const seen = new Set<string>();
  const replaced = dotenv
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const name = ASSIGNMENT.exec(line)?.[1] ?? '';
      const value = wanted.get(name);
      if (value === undefined) {
        return line;
      }
      seen.add(name);
      return `${name}=${value}`;
    });
  const appended = [...wanted].filter(([name]) => !seen.has(name)).map(([name, value]) => `${name}=${value}`);
  return `${[...replaced, ...appended].join('\n')}\n`;
}
