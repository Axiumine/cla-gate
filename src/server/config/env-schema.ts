// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { DEFAULT_SOURCE_URL } from '../../shared/meta.ts';
import { authProblems, sessionFields } from './auth-fields.ts';
import {
  databaseUrlField,
  originField,
  portField,
  sessionSecretField,
  setupTokenField,
  sweepIntervalField,
  trustProxyField,
  workerConcurrencyField,
} from './env-fields.ts';
import { githubFields, githubProblems } from './env-github.ts';
import { addConfigIssue } from './env-rules.ts';
import { missingAppVariables, resolveMode } from './mode.ts';
import { retentionFields } from './retention-fields.ts';
import { sourceCommitField, sourceUrlField } from './source-fields.ts';
import { defaultWebRoot, webRootField } from './web-root.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const DEFAULT_PORT = 3000;
const DEFAULT_WORKER_CONCURRENCY = 4;
const DEFAULT_SWEEP_INTERVAL_MINUTES = 30;

/**
 * The environment as validated, still under the variable names. {@link loadConfig} maps it to `AppConfig`. A new schema on each
 * call and not a constant built at import: a constant is evaluated while the module loads, where no test is running, and the
 * mutation gate then runs the whole suite once for every mutant in it (see "Module-level code" in docs/quality-gates.md).
 */
export function buildEnvSchema() {
  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      HOST: z.string().min(1).default('127.0.0.1'),
      PORT: portField().default(DEFAULT_PORT),
      LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
      DATABASE_URL: databaseUrlField(),
      PUBLIC_BASE_URL: originField().optional(),
      TRUST_PROXY: trustProxyField().default(false),
      SESSION_SECRET: sessionSecretField().optional(),
      SETUP_TOKEN: setupTokenField().optional(),
      WORKER_CONCURRENCY: workerConcurrencyField().default(DEFAULT_WORKER_CONCURRENCY),
      SWEEP_INTERVAL_MINUTES: sweepIntervalField().default(DEFAULT_SWEEP_INTERVAL_MINUTES),
      WEB_ROOT: webRootField().default(defaultWebRoot()),
      SOURCE_URL: sourceUrlField.default(DEFAULT_SOURCE_URL),
      SOURCE_COMMIT: sourceCommitField.default(null),
      ...githubFields(),
      ...sessionFields(),
      ...retentionFields(),
    })
    .superRefine((env, ctx) => {
      // Session cookies are `Secure` and `__Host-` prefixed, so a production deployment is HTTPS by definition.
      if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL?.startsWith('https://')) {
        addConfigIssue(ctx, {
          variable: 'PUBLIC_BASE_URL',
          rule: 'required as an https origin when NODE_ENV=production (for example https://cla.example.com)',
        });
      }
      for (const problem of [...resolveMode(env).problems, ...githubProblems(env)]) {
        addConfigIssue(ctx, problem);
      }
      const invalid = new Set(ctx.issues.map((issue) => issue.path?.[0]));
      for (const problem of authProblems({ ...env, appConfigured: missingAppVariables(env).length === 0 }, invalid)) {
        addConfigIssue(ctx, problem);
      }
    });
}

export type ValidEnv = z.output<ReturnType<typeof buildEnvSchema>>;
