// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { rulesetFile } from './rulesets.ts';

interface Rules {
  readonly name: string;
  readonly body: string;
}

/**
 * Writes `<rulesDir>/<name>.yaml` for every rule set. Each file is written under a temporary name and renamed, so
 * a Semgrep run that reads `rules/` at the same moment never sees half a file. Throws on a file system error.
 */
export function writeRules(rulesDir: string, rules: readonly Rules[]): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the repository's rules directory
  fs.mkdirSync(rulesDir, { recursive: true });
  for (const { name, body } of rules) {
    const file = path.join(rulesDir, rulesetFile(name));
    const temporary = `${file}.partial`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: a fixed rule set name inside the rules directory
    fs.writeFileSync(temporary, body);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the temporary file just written
    fs.renameSync(temporary, file);
  }
}
