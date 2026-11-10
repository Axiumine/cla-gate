// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { ConfigIssue } from './config-issue.ts';
import type { ValidEnv } from './env-schema.ts';

// The rule that each variable of the environment schema has to meet, in words (E19-S02). A start-up failure prints
// `VARIABLE: <rule>` for every invalid variable at once. The rules are written here and not taken from the validators, so
// that no message of a library, which might quote the input, can reach a log, and so that each reads as an instruction.

/** The rule of every variable of the schema; `satisfies` makes a field added to the schema without a rule a compile error. */
const FIELD_RULES = {
  NODE_ENV: 'must be one of development, test, production',
  HOST: 'must not be empty',
  PORT: 'must be a whole number from 0 to 65535 (digits only)',
  LOG_LEVEL: 'must be one of fatal, error, warn, info, debug, trace, silent',
  DATABASE_URL: 'must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)',
  PUBLIC_BASE_URL:
    'must be an origin such as https://cla.example.com (scheme and host only); https is required when NODE_ENV=production',
  TRUST_PROXY:
    'must be true, false, a hop count, or a comma separated list of proxy IPs and CIDRs (a /0 prefix is refused)',
  SESSION_SECRET: 'must be at least 32 characters',
  WORKER_CONCURRENCY: 'must be a whole number from 1 to 32 (digits only)',
  SWEEP_INTERVAL_MINUTES: 'must be one of 0, 5, 10, 15, 20, 30, 60',
  WEB_ROOT: 'must be a directory path',
  SOURCE_URL: 'must be an https address without credentials, query, fragment or trailing slash',
  SOURCE_COMMIT: 'must be a 40 character lower case hexadecimal commit id, or empty, or unknown',
  GITHUB_APP_ID: 'must be digits only, 1 to 20 of them',
  GITHUB_APP_PRIVATE_KEY: 'must be a PEM RSA private key of at least 2048 bits (PKCS#1 or PKCS#8)',
  GITHUB_APP_PRIVATE_KEY_PREVIOUS: 'must be a PEM RSA private key of at least 2048 bits (PKCS#1 or PKCS#8)',
  GITHUB_ALLOWED_ACCOUNT_IDS:
    'must be a comma separated list of at most 100 positive whole numbers (GitHub account ids)',
  OPERATOR_GITHUB_IDS: 'must be a comma separated list of at most 20 positive whole numbers (GitHub user ids)',
  GITHUB_WEBHOOK_SECRET: 'must be at least 16 characters',
  GITHUB_WEBHOOK_SECRET_PREVIOUS: 'must be at least 16 characters',
  GITHUB_CLIENT_ID: 'must not be empty',
  GITHUB_CLIENT_SECRET: 'must not be empty',
  SETUP_TOKEN: 'must be at least 32 characters',
  SESSION_IDLE_SECONDS: 'must be a whole number of seconds from 300 to 999999999 (digits only)',
  SESSION_ABSOLUTE_SECONDS: 'must be a whole number of seconds from 300 to 999999999 (digits only)',
  NETWORK_METADATA_RETENTION_DAYS: 'must be a whole number of days from 1 to 90 (digits only)',
  RECORD_NETWORK_METADATA: 'must be exactly true or false (lower case)',
  RETENTION_WEBHOOK_DELIVERIES_DAYS: 'must be a whole number of days from 7 to 3650 (digits only)',
  RETENTION_BATCH_SIZE: 'must be a whole number of rows from 1 to 100000 (digits only, no leading zero)',
} as const satisfies Record<keyof ValidEnv, string>;

const RULES: ReadonlyMap<string, string> = new Map(Object.entries(FIELD_RULES));

/**
 * @returns the rule of `variable`; for a name that is not in the schema, the plain `is invalid`: what to say about a
 * variable that failed a rule nobody wrote down, which the type check keeps unreachable for the schema.
 */
export function ruleOf(variable: string): string {
  return RULES.get(variable) ?? 'is invalid';
}

/**
 * The issues of a failed parse, one per variable, in the order zod found them (a variable that failed its own check comes
 * before a cross-field rule about it). The rule of an issue that a cross-field check raised travels in `params.rule`; every
 * other issue gets the rule of its variable, and its own message is dropped. An issue at the root of the object, with no
 * variable, has nothing to name and is left out.
 */
export function issuesOf(error: z.ZodError): ConfigIssue[] {
  const issues = new Map<string, string>();
  for (const issue of error.issues) {
    const variable = issue.path[0];
    if (typeof variable !== 'string' || issues.has(variable)) {
      continue;
    }
    const given: unknown = issue.code === 'custom' ? issue.params?.['rule'] : undefined;
    issues.set(variable, typeof given === 'string' ? given : ruleOf(variable));
  }
  return [...issues].map(([variable, rule]) => ({ variable, rule }));
}

/** Records `problem` on the variable it names, with its rule as it is written. */
export function addConfigIssue(ctx: z.RefinementCtx, problem: ConfigIssue): void {
  ctx.addIssue({ code: 'custom', path: [problem.variable], message: problem.rule, params: { rule: problem.rule } });
}
