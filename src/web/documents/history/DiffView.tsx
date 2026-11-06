// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useId, useMemo, useState } from 'react';
import { useT } from '../../i18n/index.ts';
import { classNames } from '../../ui/class-names.ts';
import { Button, UserText } from '../../ui/index.ts';
import { formatVersion } from '../version-number.ts';
import type { VersionDetail } from './history-queries.ts';
import { type DiffLine, diffOf, foldRuns, isIdentical } from './line-diff.ts';

/** The mark in front of a line: `+` for added, `-` for removed, and nothing for a line both versions have. It is drawn, so colour is never the only signal. */
function markOf(line: DiffLine): string {
  switch (line.kind) {
    case 'added':
      return '+';
    case 'removed':
      return '-';
    case 'same':
      return '';
  }
}

/** The tint of a line: the pairs of tokens a badge uses (`contrast.test.ts` checks them in both themes). */
function tintOf(line: DiffLine): string | undefined {
  switch (line.kind) {
    case 'added':
      return 'bg-success-bg text-success-fg';
    case 'removed':
      return 'bg-danger-bg text-danger-fg';
    case 'same':
      return undefined;
  }
}

/**
 * One line of a diff: its mark, the word "added" or "removed" for a screen reader (visually hidden), and the line as text through
 * `UserText`, so a line of hostile text is drawn as the characters it is made of, and its hidden and direction-changing characters
 * are written out. A line keeps its blanks, and an empty one keeps its height.
 */
function DiffRow({ line }: { readonly line: DiffLine }) {
  const t = useT();
  return (
    <li className={classNames('flex gap-2 px-3 py-0.5', tintOf(line))}>
      <span aria-hidden="true" className="w-3 shrink-0 select-none">
        {markOf(line)}
      </span>
      {line.kind === 'same' ? null : (
        <span className="sr-only">{t(line.kind === 'added' ? 'history.diff.added' : 'history.diff.removed')}</span>
      )}
      <span className="min-h-lh whitespace-pre-wrap">
        <UserText>{line.text}</UserText>
      </span>
    </li>
  );
}

/** A run of unchanged lines folded away: one button that opens it, and says how many lines it holds. */
function UnchangedRun({ lines }: { readonly lines: readonly DiffLine[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const runId = useId();
  return (
    <li className="flex flex-col items-start">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? runId : undefined}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {t.plural(open ? 'history.diff.unchanged.hide' : 'history.diff.unchanged.show', lines.length)}
      </Button>
      {open ? (
        <ul id={runId} className="w-full">
          {lines.map((line) => (
            <DiffRow key={line.at} line={line} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export interface DiffViewProps {
  readonly from: VersionDetail;
  readonly to: VersionDetail;
}

/**
 * The line diff of two versions (E18-S11), computed in the browser from the two texts the server sent (the `diff` package; nothing is
 * sent anywhere). Added and removed lines carry `+` or `-` and the visually hidden word "added" or "removed"; unchanged lines in a run
 * of more than six fold into a group that opens; texts with no line that differs say "No differences". The lines are text a person
 * wrote, drawn as text nodes and never as markup.
 */
export function DiffView({ from, to }: DiffViewProps) {
  const t = useT();
  const lines = useMemo(() => diffOf(from.contentMd, to.contentMd), [from.contentMd, to.contentMd]);
  if (isIdentical(lines)) {
    return <p className="rounded-md border border-line bg-surface p-4">{t('history.compare.same')}</p>;
  }
  return (
    <ul
      aria-label={t('history.diff.label', { from: formatVersion(from), to: formatVersion(to) })}
      className="overflow-x-auto rounded-md border border-line bg-surface font-mono text-sm"
    >
      {foldRuns(lines).map((item) =>
        item.type === 'line' ? (
          <DiffRow key={item.line.at} line={item.line} />
        ) : (
          <UnchangedRun key={item.at} lines={item.lines} />
        ),
      )}
    </ul>
  );
}
