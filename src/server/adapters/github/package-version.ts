// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// The version in `package.json`, for the User-Agent GitHub sees (E05-S04). It is read from the file at run time: the
// build (`dist/server/adapters/github`) and the sources (`src/server/adapters/github`) are the same distance from the
// repository root, and TypeScript cannot import a file outside `src` into the build.

const packageSchema = z.object({ version: z.string().min(1) });

/**
 * The `version` of the `package.json` at `file`.
 * @throws Error when the file cannot be read or has no version. The message names the file, never its content.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function readPackageVersion(file: string): string {
  let text: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the repository's own package.json, fixed by packageVersion(), never user input
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`The package version cannot be read: ${file} is missing or unreadable`);
  }
  try {
    return packageSchema.parse(JSON.parse(text)).version;
  } catch {
    throw new Error(`The package version cannot be read: ${file} has no "version" string`);
  }
}

let cached: string | undefined;

/** The version of this build, read once. @throws Error as {@link readPackageVersion}. */
export function packageVersion(): string {
  cached ??= readPackageVersion(path.resolve(import.meta.dirname, '../../../../package.json'));
  return cached;
}
