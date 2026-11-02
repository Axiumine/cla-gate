// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { commentsOf, type SourceComment } from './comments.ts';
import { rangeDirectives, startsWithRange } from './ranges.ts';
import { hasPreserve, hasReason, hasReasonAfterPreserve } from './reason.ts';
import { type Finding, type Hatch, PRESERVE, REASON } from './types.ts';

// E20-S16: finds the escape hatches that no linter checks for a written justification: an
// explicit `any`, an `as` assertion other than `as const`, a coverage-ignore comment or range line (ranges.ts), a
// type-coverage ignore comment and a Qodana `//noinspection <Name>` comment (E20-S08). ESLint (ban-ts-comment and
// eslint-comments) and Biome cover the other directives.

interface Construct {
  readonly hatch: Hatch;
  readonly line: number;
}

// A comment that starts with one of these is a coverage hint (Vitest honours `istanbul`, `v8` and `c8` spellings alike).
const COVERAGE_IGNORE = /^(?:(?:istanbul|v8|c8) ignore|node:coverage (?:ignore|disable))(?![\w-])/;
const TYPE_COVERAGE_IGNORE = /type-coverage:ignore-(?:next-)?line/;
const NOINSPECTION = /^noinspection(?![\w-])/;
/** Directives that only need a reason in the same comment, after ` -- `. */
const REASON_DIRECTIVES: readonly (readonly [RegExp, Hatch])[] = [
  [TYPE_COVERAGE_IGNORE, 'type-coverage ignore'],
  [NOINSPECTION, 'noinspection'],
];

function isConstType(type: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const';
}

/** The `any` keywords and `as` / angle-bracket assertions below `node`, with the line each one starts on. */
function constructsOf(node: ts.Node, sourceFile: ts.SourceFile): Construct[] {
  const lineAt = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const own: Construct[] = [];
  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    own.push({ hatch: 'any', line: lineAt(node.getStart(sourceFile)) });
  } else if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConstType(node.type)) {
    own.push({ hatch: 'as assertion', line: lineAt(node.type.getStart(sourceFile)) });
  }
  // The callback must return nothing: forEachChild stops at the first truthy value, and push() returns the new length.
  const nested: Construct[][] = [];
  ts.forEachChild(node, (child) => {
    nested.push(constructsOf(child, sourceFile));
  });
  return [...own, ...nested.flat()];
}

/** A comment with a reason on the construct's line, or alone on the line above it, justifies the construct. */
function isJustified(line: number, comments: readonly SourceComment[]): boolean {
  return comments.some(
    (comment) =>
      hasReason(comment.body) && (comment.endLine === line || (comment.endLine === line - 1 && comment.ownLine)),
  );
}

/** The elements a coverage-ignore directive lacks: the preserve marker, then a reason after it. */
function preserveMissing(body: string): string[] {
  if (!hasPreserve(body)) {
    return [PRESERVE];
  }
  return hasReasonAfterPreserve(body) ? [] : [`a reason after ${PRESERVE}`];
}

function directiveFindings(file: string, comment: SourceComment): Finding[] {
  // A range directive is reported by the range pass, on the raw line Vitest reads it from.
  const hint = COVERAGE_IGNORE.test(comment.body) && !startsWithRange(comment.body);
  const coverage = (hint ? preserveMissing(comment.body) : []).map(
    (missing): Finding => ({ file, line: comment.line, hatch: 'v8 ignore', missing }),
  );
  const reasonless = REASON_DIRECTIVES.filter(
    ([pattern]) => pattern.test(comment.body) && !hasReason(comment.body),
  ).map(([, hatch]): Finding => ({ file, line: comment.line, hatch, missing: `${REASON} in the same comment` }));
  return [...coverage, ...reasonless];
}

/** Every unjustified escape hatch in `text`, the source of `file`, ordered by line. */
export function scanSource(file: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const comments = commentsOf(sourceFile);
  // One finding per kind and line: `x as unknown as T` is one assertion to justify, not two.
  const constructs = new Map(constructsOf(sourceFile, sourceFile).map((item) => [`${item.hatch}:${item.line}`, item]));
  const unjustified = [...constructs.values()]
    .filter((construct) => !isJustified(construct.line, comments))
    .map((construct): Finding => ({ file, ...construct, missing: `${REASON} on this line or the line above` }));
  const directives = comments.flatMap((comment) => directiveFindings(file, comment));
  const ranges = rangeDirectives(sourceFile, comments).flatMap((range) =>
    preserveMissing(range.text).map((missing): Finding => ({ file, line: range.line, hatch: 'v8 ignore', missing })),
  );
  return [...unjustified, ...directives, ...ranges].sort((a, b) => a.line - b.line);
}
