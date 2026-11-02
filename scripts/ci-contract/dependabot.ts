// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse } from 'yaml';
import { z } from 'zod';

// E20-S09: packages that must be bumped together get one Dependabot group. Playwright's version is also the tag of the
// browser image (a bump of the package alone fails scripts/e2e-pin.test.ts), the Stryker packages are released in lockstep,
// and memlab 2.0.x needs the same version of @memlab/api. A dependency joins the FIRST group whose patterns match it, so the
// lockstep groups must come before any group that matches everything, and they must not narrow the update types (a major
// bump of one package has to carry the others).

const LOCKSTEP: readonly (readonly string[])[] = [
  ['@playwright/test'],
  ['@stryker-mutator/*'],
  ['memlab', '@memlab/api'],
];

const groupSchema = z.looseObject({ patterns: z.array(z.string()).optional(), 'update-types': z.unknown().optional() });
const configSchema = z.object({
  updates: z.array(
    z.looseObject({ 'package-ecosystem': z.string(), groups: z.record(z.string(), groupSchema).optional() }),
  ),
});

type Entry = readonly [name: string, group: z.infer<typeof groupSchema>];

function lockstepProblems(groups: readonly Entry[], patterns: readonly string[]): string[] {
  const label = patterns.join(' and ');
  const found = groups.find(([, group]) => patterns.every((pattern) => group.patterns?.includes(pattern) ?? false));
  if (found === undefined) {
    return [`dependabot.yml: no npm group holds ${label} together`];
  }
  const index = groups.indexOf(found);
  const [name, group] = found;
  const catchAll = groups.findIndex(([, other]) => other.patterns?.includes('*') ?? false);
  return [
    ...(catchAll !== -1 && catchAll < index
      ? [
          `dependabot.yml: the group "${name}" (${label}) comes after a group that matches "*", which would take its packages`,
        ]
      : []),
    ...(Object.hasOwn(group, 'update-types')
      ? [
          `dependabot.yml: the group "${name}" (${label}) must not restrict update-types, or a major bump would split the lockstep`,
        ]
      : []),
  ];
}

/** What is wrong with the npm groups of a dependabot.yml text, one sentence each; empty when every lockstep group exists. */
export function dependabotProblems(text: string): string[] {
  const raw: unknown = parse(text);
  const config = configSchema.parse(raw);
  const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm');
  if (npm === undefined) {
    return ['dependabot.yml: has no npm update entry'];
  }
  const groups = Object.entries(npm.groups ?? {});
  return LOCKSTEP.flatMap((patterns) => lockstepProblems(groups, patterns));
}
