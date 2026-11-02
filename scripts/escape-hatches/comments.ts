// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { commentBody } from './reason.ts';

// E20-S16: every comment of a source file, found through the parser so that a string, a template literal, a regular
// expression or JSX text that merely looks like a comment is never mistaken for one.

export interface SourceComment {
  /** The comment text on one line, without its delimiters. */
  readonly body: string;
  /** 1-based line the comment starts on. */
  readonly line: number;
  /** 1-based line the comment ends on. */
  readonly endLine: number;
  /** True when only whitespace precedes the comment on its first line. */
  readonly ownLine: boolean;
}

/** The tokens of the tree in source order. JSDoc is itself a comment, so its inner nodes are not tokens. */
function tokensOf(node: ts.Node, sourceFile: ts.SourceFile): ts.Node[] {
  const children = node.getChildren(sourceFile).filter((child) => !ts.isJSDoc(child));
  return children.length === 0 ? [node] : children.flatMap((child) => tokensOf(child, sourceFile));
}

/** Comment ranges around the tokens. JSX text is skipped: a `//` in it is text, not a comment. */
function rangesAround(tokens: readonly ts.Node[], text: string): ts.CommentRange[] {
  return tokens.flatMap((token, index) => {
    const nextIsText = tokens[index + 1]?.kind === ts.SyntaxKind.JsxText;
    const leading = token.kind === ts.SyntaxKind.JsxText ? [] : (ts.getLeadingCommentRanges(text, token.pos) ?? []);
    const trailing = nextIsText ? [] : (ts.getTrailingCommentRanges(text, token.end) ?? []);
    return [...leading, ...trailing];
  });
}

/** Every comment of `sourceFile`, once each, in source order. */
export function commentsOf(sourceFile: ts.SourceFile): SourceComment[] {
  const { text } = sourceFile;
  const lineOf = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const unique = new Map(rangesAround(tokensOf(sourceFile, sourceFile), text).map((range) => [range.pos, range]));
  return [...unique.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => {
      const line = lineOf(range.pos);
      return {
        body: commentBody(text.slice(range.pos, range.end)),
        line,
        endLine: lineOf(range.end),
        ownLine: text.slice(sourceFile.getPositionOfLineAndCharacter(line - 1, 0), range.pos).trim() === '',
      };
    });
}
