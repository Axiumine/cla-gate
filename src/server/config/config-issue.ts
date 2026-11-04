// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * One thing wrong with the configuration (E19-S02): the variable, or the variables (`DATABASE_URL, DATABASE_URL_FILE`),
 * and the rule that failed, in words. The rule is written by us and never contains a value or a piece of a file, so an
 * operator reads exactly what to change and a secret never reaches stderr. `ConfigError` prints it as `variable: rule`.
 */
export interface ConfigIssue {
  readonly variable: string;
  readonly rule: string;
}
