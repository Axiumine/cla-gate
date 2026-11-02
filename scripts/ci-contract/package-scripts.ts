// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { lookup } from '../ci/lib/env.ts';

// E20-S09: the script contracts of package.json. Each one is a way a gate can keep its name and go quiet: Semgrep without
// `--error` reports findings and exits 0, a Trivy pass without `--exit-code 1` does the same, `semgrep ci` ignores the
// rulesets and talks to the Semgrep platform, a mutation run without `--incremental` is too slow for CI, and a coverage run
// without `CI=1` does not take the CI-only paths.

const manifestSchema = z.object({ scripts: z.record(z.string(), z.string()) });

const EXIT_CODE_ONE = /(?<=^|\s)--exit-code 1(?=\s|$)/g;
const TRIVY_PASS = /(?<=^|[\s&])trivy fs(?=\s)/g;
const SEMGREP_CI = /(?<=^|[\s;&|(])semgrep\s+ci(?=[\s;&|)]|$)/;

function hasFlag(script: string, flag: string): boolean {
  return script.split(/\s+/).includes(flag);
}

function semgrepProblems(script: string): string[] {
  return [
    ...(hasFlag(script, '--error') ? [] : ['the semgrep script needs --error, or findings exit 0']),
    ...(/(?<=^|\s)--metrics off(?=\s|$)/.test(script) ? [] : ['the semgrep script needs --metrics off']),
  ];
}

function trivyProblems(script: string): string[] {
  const passes = script.match(TRIVY_PASS)?.length ?? 0;
  const spelled = script.match(EXIT_CODE_ONE)?.length ?? 0;
  return passes === 2 && spelled === 2
    ? []
    : [
        `the trivy script must run two passes that each spell --exit-code 1 (found ${passes} passes, ${spelled} spellings)`,
      ];
}

/** What is wrong with the scripts of a package.json text, one sentence each; empty when every contract holds. */
export function scriptProblems(packageJson: string): string[] {
  const raw: unknown = JSON.parse(packageJson);
  const { scripts } = manifestSchema.parse(raw);
  const ofScript = (name: string, check: (script: string) => string[]): string[] => {
    const script = lookup(scripts, name);
    return script === undefined ? [`package.json has no ${name} script`] : check(script);
  };
  const noSemgrepCi = Object.entries(scripts)
    .filter(([, script]) => SEMGREP_CI.test(script))
    .map(([name]) => `the ${name} script runs semgrep ci, which ignores --config and targets the Semgrep platform`);
  return [
    ...ofScript('semgrep', semgrepProblems),
    ...noSemgrepCi,
    ...ofScript('trivy', trivyProblems),
    ...ofScript('mutate', (script) =>
      hasFlag(script, '--incremental') ? [] : ['the mutate script needs --incremental'],
    ),
    ...ofScript('coverage', (script) => (/^CI=1\s/.test(script) ? [] : ['the coverage script must start with CI=1'])),
  ];
}
