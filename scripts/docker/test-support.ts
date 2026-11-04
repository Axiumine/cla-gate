// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from '../ci/lib/test-support.ts';

// What the tests of the image (E19-S01) read the Dockerfile with: a small parser, so that a test asserts on instructions and
// not on text that happens to sit in a comment or in the middle of a line.

export const ROOT = path.resolve(import.meta.dirname, '../..');

export interface Instruction {
  /** Upper case: `RUN`, `COPY`, `FROM`. */
  readonly keyword: string;
  /** Everything after the keyword, continuation lines joined with one space. */
  readonly args: string;
}

export interface Stage {
  /** The `AS` name, lower case. */
  readonly name: string;
  /** What the stage starts from: a registry image or an earlier stage. */
  readonly from: string;
  /** The instructions after the `FROM`, in order. */
  readonly instructions: readonly Instruction[];
}

export interface Dockerfile {
  /** The instructions before the first `FROM` (the global `ARG`s). */
  readonly header: readonly Instruction[];
  readonly stages: readonly Stage[];
}

/** Comments and blank lines dropped, a trailing backslash joining a line to the next one. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  let pending = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
    } else {
      lines.push(`${pending}${line}`);
      pending = '';
    }
  }
  return lines;
}

function toInstruction(line: string): Instruction {
  const [keyword = '', ...rest] = line.split(/\s+/);
  return { keyword: keyword.toUpperCase(), args: rest.join(' ') };
}

/** `FROM [--platform=x] image [AS name]`. */
function toStage(from: Instruction): Omit<Stage, 'instructions'> {
  const words = from.args.split(/\s+/).filter((word) => !word.startsWith('--'));
  const alias = words.findIndex((word) => word.toUpperCase() === 'AS');
  const [image = ''] = words;
  return { name: alias === -1 ? '' : (words[alias + 1] ?? '').toLowerCase(), from: image };
}

export function parseDockerfile(text: string): Dockerfile {
  const header: Instruction[] = [];
  const stages: { name: string; from: string; instructions: Instruction[] }[] = [];
  for (const instruction of logicalLines(text).map(toInstruction)) {
    if (instruction.keyword === 'FROM') {
      stages.push({ ...toStage(instruction), instructions: [] });
    } else {
      (stages.at(-1)?.instructions ?? header).push(instruction);
    }
  }
  return { header, stages };
}

export function readDockerfile(): Dockerfile {
  return parseDockerfile(readText(path.join(ROOT, 'Dockerfile')));
}

/** The stage called `name`; a missing one fails the test that asked for it. */
export function stageNamed(dockerfile: Dockerfile, name: string): Stage {
  const found = dockerfile.stages.find((stage) => stage.name === name);
  if (found === undefined) {
    throw new Error(`the Dockerfile has no stage ${name}`);
  }
  return found;
}

/** The arguments of every instruction of this keyword in the stage, in order. */
export function argsOf(stage: Stage, keyword: string): string[] {
  return stage.instructions
    .filter((instruction) => instruction.keyword === keyword)
    .map((instruction) => instruction.args);
}

/** Every file below `directory`, as paths relative to ROOT, `node_modules` left out. A directory that does not exist has none. */
export function listFiles(directory: string): string[] {
  const absolute = path.join(ROOT, directory);
  if (!exists(absolute)) {
    return [];
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a directory of this repository
  return fs
    .readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.split(path.sep).includes('node_modules'))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)));
}

/**
 * What would publish an image, as patterns: a push or a login to a registry, the action that logs in, the permission to write
 * packages, and the build option that pushes. Written with `\s+` and `\s*` so that this file does not contain the words it
 * looks for (scripts/docker/no-publication.test.ts scans every file under scripts/ except itself).
 */
const PUBLICATION_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['a push to a registry', /\bdocker\s+push\b/],
  ['a push to a registry', /\bdocker\s+image\s+push\b/],
  ['a login to a registry', /\bdocker\s+login\b/],
  ['the registry login action', /login\x2Daction/],
  ['the permission to write packages', /\bpackages:\s*["']?write\b/],
  ['a build that pushes', /\bpush:\s*["']?true\b/],
];

/** The names of the publication patterns that `text` contains. */
export function publicationFindings(text: string): string[] {
  return PUBLICATION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
