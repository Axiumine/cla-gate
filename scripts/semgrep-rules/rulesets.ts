// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The Semgrep Registry rule sets that `yarn semgrep` runs online (E20-S01). `yarn semgrep:rules` keeps a copy of each in
 * `rules/<name>.yaml` for offline runs; the `semgrep` script in package.json spells the same five names (a test pins
 * both).
 */
export const RULESETS = ['typescript', 'javascript', 'react', 'nodejsscan', 'secrets'] as const;

const REGISTRY_URL = 'https://semgrep.dev/c/p/';

/** Where the registry serves a rule set as one YAML document. */
export function rulesetUrl(name: string): string {
  return `${REGISTRY_URL}${name}`;
}

/** File name of the offline copy of a rule set, inside `rules/`. */
export function rulesetFile(name: string): string {
  return `${name}.yaml`;
}
