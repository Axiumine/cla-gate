// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SweepInterval } from '../domain/sweep.ts';
import { ConfigError } from './config-error.ts';
import type { ConfigIssue } from './config-issue.ts';
import { issuesOf } from './env-rules.ts';
import { envSchema, type ValidEnv } from './env-schema.ts';
import { type GithubConfig, toGithubConfig } from './github-config.ts';
import { type Mode, resolveMode } from './mode.ts';
import type { Secret } from './secret.ts';
import { resolveSecretFiles } from './secret-files.ts';
import type { TrustProxy } from './trust-proxy.ts';

/** Everything the server reads from the environment, validated and typed (see docs/configuration.md). */
export interface AppConfig {
  readonly nodeEnv: ValidEnv['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: ValidEnv['LOG_LEVEL'];
  readonly databaseUrl: Secret;
  /** Origin the public reaches the app on, without a trailing slash. */
  readonly publicBaseUrl: string;
  readonly trustProxy: TrustProxy;
  readonly sessionSecret: Secret | undefined;
  /** How long a session lives (E10-S01), in seconds; idle is never above absolute and neither is below 300. */
  readonly session: { readonly idleSeconds: number; readonly absoluteSeconds: number };
  /** How many jobs of one queue run at once in this process (E07-S03), 1 to 32. */
  readonly workerConcurrency: number;
  /** Minutes between two reconciliation sweeps (E07-S08): 5, 10, 15, 20, 30 or 60, or 0 for none. */
  readonly sweepIntervalMinutes: SweepInterval;
  readonly github: GithubConfig;
  /**
   * `normal` with the GitHub App configured, `setup` while none exists and the first-run flow (E19-S06) creates it
   * (E19-S02, `resolveMode` in mode.ts).
   */
  readonly mode: Mode;
  /** The token that unlocks the first-run flow: present in `setup` mode only (it is required there in production). */
  readonly setupToken: Secret | undefined;
  /** True when `SETUP_TOKEN` is set while the App is configured: the token is dropped, and start-up logs a warning. */
  readonly setupTokenIgnored: boolean;
  /** The directory the single-page app is served from (E17-S03): absolute, `dist/web` unless `WEB_ROOT` says otherwise. */
  readonly webRoot: string;
  /** Where the corresponding source of the running version is (E17-S09, AGPL section 13): the repository and, when the build knows it, the commit. */
  readonly source: { readonly url: string; readonly commit: string | null };
  /** How many days the IP address and user agent of a signature are kept (E16-S05), 1 to 90. */
  readonly networkMetadataRetentionDays: number;
  /** Whether the sign request stores the client address and the user agent (E13-S05). Off unless `RECORD_NETWORK_METADATA=true`. */
  readonly recordNetworkMetadata: boolean;
  /** The retention sweep of the operational rows (E22-S04): the days a processed webhook delivery is kept (7 to 3650) and the rows one batch deletes. */
  readonly retention: { readonly webhookDeliveriesDays: number; readonly batchSize: number };
}

/** The mode, with the token only where it is used and a note when it is dropped. */
function modeSettings(env: ValidEnv): Pick<AppConfig, 'mode' | 'setupToken' | 'setupTokenIgnored'> {
  const { mode } = resolveMode(env);
  return {
    mode,
    setupToken: mode === 'setup' ? env.SETUP_TOKEN : undefined,
    setupTokenIgnored: mode === 'normal' && env.SETUP_TOKEN !== undefined,
  };
}

function toAppConfig(env: ValidEnv): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`,
    trustProxy: env.TRUST_PROXY,
    sessionSecret: env.SESSION_SECRET,
    session: { idleSeconds: env.SESSION_IDLE_SECONDS, absoluteSeconds: env.SESSION_ABSOLUTE_SECONDS },
    workerConcurrency: env.WORKER_CONCURRENCY,
    sweepIntervalMinutes: env.SWEEP_INTERVAL_MINUTES,
    github: toGithubConfig(env),
    ...modeSettings(env),
    webRoot: env.WEB_ROOT,
    source: { url: env.SOURCE_URL, commit: env.SOURCE_COMMIT },
    networkMetadataRetentionDays: env.NETWORK_METADATA_RETENTION_DAYS,
    recordNetworkMetadata: env.RECORD_NETWORK_METADATA,
    retention: { webhookDeliveriesDays: env.RETENTION_WEBHOOK_DELIVERIES_DAYS, batchSize: env.RETENTION_BATCH_SIZE },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** An empty variable (`PORT=` in a compose file) counts as unset. A variable that is undefined already does (zod). */
function withoutEmpty(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

const byVariable = (a: ConfigIssue, b: ConfigIssue): number => a.variable.localeCompare(b.variable);

/**
 * Validates `env` or throws a {@link ConfigError} naming every invalid variable with the rule it failed. The `N_FILE`
 * variants of the secrets are read first (secret-files.ts), so the schema parses a secret the same way whether it came
 * from `N` or from a file.
 */
export function loadConfig(env: Env): AppConfig {
  const secrets = resolveSecretFiles(env);
  const result = envSchema.safeParse(withoutEmpty(secrets.env));
  if (secrets.issues.length === 0 && result.success) {
    return toAppConfig(result.data);
  }
  const parsed = result.success ? [] : issuesOf(result.error).filter((issue) => !secrets.failed.has(issue.variable));
  throw new ConfigError([...secrets.issues, ...parsed].toSorted(byVariable));
}
