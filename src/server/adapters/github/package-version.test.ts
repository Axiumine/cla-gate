// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { apiHeaders } from './api-headers.ts';
import { packageVersion, readPackageVersion } from './package-version.ts';

const PACKAGE_JSON = path.resolve(import.meta.dirname, '../../../../package.json');

/** A package.json with `content`, in a directory that is removed when the test ends. */
function packageWith(content: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cla-package-version-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'package.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside the directory mkdtempSync made above
  writeFileSync(file, content);
  return file;
}

test('packageVersion is the version in the repository package.json', () => {
  const { version } = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')));
  expect(packageVersion()).toBe(version);
  expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});

test('the User-Agent is cla-gate/<package version> and the API version is pinned', () => {
  expect(apiHeaders()).toStrictEqual({
    accept: 'application/vnd.github+json',
    'user-agent': `cla-gate/${packageVersion()}`,
    'x-github-api-version': '2022-11-28',
  });
});

test('readPackageVersion reads the version of the file it is given', () => {
  expect(readPackageVersion(packageWith('{"name":"x","version":"3.4.5-rc.1"}'))).toBe('3.4.5-rc.1');
});

test.each([
  ['is not JSON', 'not json at all, secret-text'],
  ['has no version', '{"name":"x","note":"secret-text"}'],
  ['has a version that is not a string', '{"version":3}'],
  ['has an empty version', '{"version":""}'],
  ['is a JSON array', '[1]'],
])('readPackageVersion fails when the file %s, naming the file and quoting nothing', (_name, content) => {
  const file = packageWith(content);
  expect(() => readPackageVersion(file)).toThrow(`${file} has no "version" string`);
  expect(() => readPackageVersion(file)).not.toThrow(/secret-text/);
});

test('readPackageVersion fails when the file is missing, naming it', () => {
  const file = path.join(path.dirname(packageWith('{}')), 'absent.json');
  expect(() => readPackageVersion(file)).toThrow(`${file} is missing or unreadable`);
});
