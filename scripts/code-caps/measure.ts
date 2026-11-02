// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { Collector } from './collector.ts';
import { CAPS, CapsError, type Measure, measureKey } from './types.ts';

const PARSE_OPTIONS: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, types: [] };

// --------------------------------------------------------------------------- parsing

/** Parse one module. Throws `CapsError` (file and line) on a syntax error. */
function parse(source: string, rel: string): ts.SourceFile {
  const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost(PARSE_OPTIONS);
  // Stryker disable next-line ArrowFunction: the syntactic diagnostics are read from the file itself and the program only carries them, so what the host hands out changes nothing
  host.getSourceFile = () => file;
  // Stryker disable next-line ArrayDeclaration: same reason, the list of root files does not change the diagnostics of `file`
  const program = ts.createProgram({ rootNames: [rel], options: PARSE_OPTIONS, host });
  const [first] = program.getSyntacticDiagnostics(file);
  if (first !== undefined) {
    const line = file.getLineAndCharacterOfPosition(first.start).line + 1;
    // Stryker disable next-line StringLiteral: the parser's messages are plain strings, never chains, so the line separator is never used
    throw new CapsError(`${rel}:${line}: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`);
  }
  return file;
}

// --------------------------------------------------------------------------- measures

/**
 * Number of lines of a text: a trailing line break does not start a new line.
 * @internal Exported for the unit tests.
 */
export function countLines(text: string): number {
  const parts = text.split(/\r\n|[\n\r\u2028\u2029]/);
  return parts.length - (parts.at(-1) === '' ? 1 : 0);
}

/**
 * Make keys unique when a qualified name repeats (anonymous callbacks, overloads): `name#2`.
 * @internal Exported for the unit tests.
 */
export function dedupeNames(found: readonly Measure[]): Measure[] {
  const seen = new Map<string, number>();
  return found.map((item) => {
    const count = (seen.get(measureKey(item)) ?? 0) + 1;
    seen.set(measureKey(item), count);
    return count === 1 ? item : { ...item, name: `${item.name}#${count}` };
  });
}

function measureParsed(source: string, rel: string): Measure[] {
  const file = parse(source, rel);
  const found: Measure[] = [];
  const lines = countLines(source);
  if (lines > CAPS.file) {
    found.push({ path: rel, line: 1, kind: 'file', name: '-', value: lines });
  }
  const collector = new Collector(file, rel);
  collector.visit(file, []);
  return dedupeNames([...found, ...collector.found]);
}

/** All violations in one module's source text. Throws `CapsError` on a syntax error or an unmeasurable file. */
export function measureSource(source: string, rel: string): Measure[] {
  try {
    return measureParsed(source, rel);
  } catch (cause) {
    if (cause instanceof CapsError) {
      throw cause;
    }
    throw new CapsError(`${rel}: cannot measure: ${String(cause)}`, { cause });
  }
}
