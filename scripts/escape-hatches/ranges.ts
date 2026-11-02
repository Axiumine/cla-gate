// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type ts from 'typescript';
import type { SourceComment } from './comments.ts';
import { directiveText } from './reason.ts';

// E20-S16: Vitest's coverage code (ast-v8-to-istanbul) matches `ignore start` and `ignore stop` against every raw source
// line, with no anchor: it does not matter whether the text is in a comment, behind other words of a comment, in a
// string or in a template literal. Every such line is an escape hatch that hides code from the 100% gate. (The
// `ignore next`, `if`, `else` and `file` forms are different: they only count at the start of a real comment, which
// `scan.ts` checks through the parser.)

const RANGE_IGNORE = /(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(?:start|stop)(?=\W|$)/;

/** True when a comment's text starts with a range directive: the range pass reports that one, on the directive's line. */
export function startsWithRange(body: string): boolean {
  return RANGE_IGNORE.exec(body)?.index === 0;
}

/** A line that holds a range directive, and the directive's text up to the end of its comment or line. */
export interface RangeDirective {
  readonly line: number;
  readonly text: string;
}

/** Every line of `sourceFile` that holds a range directive, whatever the directive sits in. */
export function rangeDirectives(sourceFile: ts.SourceFile, comments: readonly SourceComment[]): RangeDirective[] {
  const { text } = sourceFile;
  return sourceFile.getLineStarts().flatMap((lineStart, index, starts) => {
    const lineEnd = starts[index + 1] ?? text.length;
    const match = RANGE_IGNORE.exec(text.slice(lineStart, lineEnd));
    if (match === null) {
      return [];
    }
    const position = lineStart + match.index;
    const comment = comments.find((candidate) => candidate.start <= position && position < candidate.end);
    return [{ line: index + 1, text: directiveText(text.slice(position, comment?.end ?? lineEnd)) }];
  });
}
