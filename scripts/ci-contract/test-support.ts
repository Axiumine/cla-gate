// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** A full commit SHA, the shape every pinned `uses:` has. */
export const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';

/** A workflow with one job whose steps are the given lines (each is the text after the dash of one step). */
export function workflowWithSteps(...steps: readonly string[]): string {
  return [
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    ...steps.map((step) => `      - ${step}`),
    '',
  ].join('\n');
}

/** A workflow whose jobs are the given blocks (each already indented by two spaces) and whose trigger is `on`. */
export function workflowWithJobs(on: string, ...jobs: readonly string[]): string {
  return [`on: ${on}`, 'jobs:', ...jobs, ''].join('\n');
}
