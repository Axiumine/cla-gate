// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { authProblems, sessionFields } from './auth-fields.ts';
import { databaseUrlField, originField, portField, sessionSecretField, trustProxyField } from './env-fields.ts';
import { githubFields, githubProblems } from './env-github.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const DEFAULT_PORT = 3000;

/** The environment as validated, still under the variable names. {@link loadConfig} maps it to `AppConfig`. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: portField.default(DEFAULT_PORT),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: databaseUrlField,
    PUBLIC_BASE_URL: originField.optional(),
    TRUST_PROXY: trustProxyField.default(false),
    SESSION_SECRET: sessionSecretField.optional(),
    ...githubFields,
    ...sessionFields,
  })
  .superRefine((env, ctx) => {
    // Session cookies are `Secure` and `__Host-` prefixed, so a production deployment is HTTPS by definition.
    if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL?.startsWith('https://')) {
      // Stryker disable next-line StringLiteral: only the variable name of an issue is ever reported, never its message
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'https origin required in production' });
    }
    for (const name of githubProblems(env)) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'invalid GitHub App setting' });
    }
    const invalid = new Set(ctx.issues.map((issue) => issue.path?.[0]));
    for (const name of authProblems(env, invalid)) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'invalid login setting' });
    }
  });

export type ValidEnv = z.output<typeof envSchema>;
