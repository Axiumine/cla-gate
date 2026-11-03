// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { AUTH_ENV } from '../auth-fixture/test-support.ts';
import { TEST_SETUP_TOKEN, TEST_WEBHOOK_SECRET, testRsaKey } from '../test-support.ts';

// A directory of secret files for the tests of E19-S02, removed after the current test. Every value in it is made up.

export interface SecretDirectory {
  /** The directory itself. */
  readonly root: string;
  /** Writes `content` to the file `name` and returns its path. The bytes are written as they are: no line break is added. */
  write(name: string, content: string | Buffer): string;
  /** Makes `name` a symbolic link to `target` and returns the path of the link. */
  link(name: string, target: string): string;
  /** The path of `name`, whether or not the file exists. */
  at(name: string): string;
}

export function secretDirectory(): SecretDirectory {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cla-secrets-'));
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const at = (name: string): string => path.join(root, name);
  return {
    root,
    at,
    write: (name, content) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside a directory created by mkdtemp
      fs.writeFileSync(at(name), content);
      return at(name);
    },
    link: (name, target) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside a directory created by mkdtemp
      fs.symlinkSync(target, at(name));
      return at(name);
    },
  };
}

/** A made-up PostgreSQL connection string. */
export const SAMPLE_DATABASE_URL = 'postgres://cla_app:made-up-password@db.internal:5432/cla';

/**
 * One valid value for every variable of the environment schema, GitHub App complete (so the mode is `normal`) and with a
 * setup token. A test fails when the schema gains a field that this object does not give a value to, which is how a new
 * secret cannot slip past the `_FILE` list.
 */
export function sampleEnvironment(): Readonly<Record<string, string>> {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: SAMPLE_DATABASE_URL,
    PUBLIC_BASE_URL: 'https://cla.example.org',
    TRUST_PROXY: '1',
    ...AUTH_ENV,
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    WORKER_CONCURRENCY: '4',
    SWEEP_INTERVAL_MINUTES: '30',
    WEB_ROOT: '/srv/web',
    SOURCE_URL: 'https://github.com/example/fork',
    SOURCE_COMMIT: 'a'.repeat(40),
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: testRsaKey().pkcs8,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: testRsaKey().pkcs1,
    GITHUB_ALLOWED_ACCOUNT_IDS: '1,2',
    OPERATOR_GITHUB_IDS: '3',
    GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    GITHUB_WEBHOOK_SECRET_PREVIOUS: `${TEST_WEBHOOK_SECRET}-previous`,
    SESSION_IDLE_SECONDS: '3600',
    SESSION_ABSOLUTE_SECONDS: '7200',
    NETWORK_METADATA_RETENTION_DAYS: '30',
  };
}
