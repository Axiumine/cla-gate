// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConfigIssue } from './config-issue.ts';

/**
 * Thrown for an invalid environment (E19-S02). Carries one issue per invalid variable, all of them at once, and the
 * message is one line each, `VARIABLE: <rule that failed>`. Names and rules only: a value must never reach an error message or log.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly issues: readonly ConfigIssue[];
  /** The variable of each issue, in the order of the issues. */
  readonly variables: readonly string[];

  constructor(issues: readonly ConfigIssue[]) {
    super(issues.map(configLine).join('\n'));
    this.issues = issues;
    this.variables = issues.map((issue) => issue.variable);
  }

  /** What is printed: one line per issue. */
  get lines(): readonly string[] {
    return this.issues.map(configLine);
  }
}

function configLine(issue: ConfigIssue): string {
  return `${issue.variable}: ${issue.rule}`;
}
