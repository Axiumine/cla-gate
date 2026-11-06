// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { auditLogItemSchema } from '../../shared/audit-log.ts';
import { visibleText } from '../ui/user-text.ts';

// The metadata block of an audit row (E18-S09): the object of the row as plain text, for a `<pre>`. The contract says it holds ids,
// counts, flags and codes and no personal data; the screen still draws it as inert text: it is never parsed as HTML or markdown, the
// keys are sorted so the same row reads the same on every visit, and the characters that change how text is drawn are written out.

/** What one key of the metadata may hold: any JSON value, because a row outlives the release that wrote it. */
type JsonValue = z.infer<typeof auditLogItemSchema>['metadata'][string];

const INDENT = '  ';

/** The order of two keys by their code units: the same on every machine and in every language, unlike a locale's. */
const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  Number(a > b) - Number(a < b);

function lines(value: JsonValue, depth: number): string {
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${lines(item, depth + 1)}`);
    return items.length === 0 ? '[]' : `[\n${items.join(',\n')}\n${outer}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .toSorted(byKey)
      .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${lines(item, depth + 1)}`);
    return entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${outer}}`;
  }
  return JSON.stringify(value);
}

/**
 * `metadata` as indented JSON with its keys sorted at every level, each hidden or bidirectional character written out as `<U+XXXX>`
 * (`visibleText`). Strings are quoted and escaped by `JSON.stringify`, so a value can never look like the structure around it.
 */
export function metadataText(metadata: z.infer<typeof auditLogItemSchema>['metadata']): string {
  return visibleText(lines(metadata, 0));
}
