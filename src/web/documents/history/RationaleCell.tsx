// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useId, useState } from 'react';
import { useT } from '../../i18n/index.ts';
import { Button, UserText } from '../../ui/index.ts';
import { clipText } from '../../ui/user-text.ts';

/**
 * How many characters of a rationale the list shows before it offers the rest.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const RATIONALE_PREVIEW = 200;

export interface RationaleCellProps {
  /** What the admin who published the version wrote: text a person controls. */
  readonly text: string;
}

/**
 * The rationale of a version (E18-S11) through `UserText`: whole when it is up to 200 characters, else cut at 200 with a button that
 * shows all of it and one that goes back. The cut text keeps the whole rationale in the page for assistive technology, and the
 * button says it expands the text it names (`aria-expanded`, `aria-controls`). Nothing here reads markup: it is a text node.
 */
export function RationaleCell({ text }: RationaleCellProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const textId = useId();
  if (clipText(text, RATIONALE_PREVIEW) === null) {
    return <UserText>{text}</UserText>;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <div id={textId}>
        {open ? <UserText>{text}</UserText> : <UserText maxLength={RATIONALE_PREVIEW}>{text}</UserText>}
      </div>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {t(open ? 'history.rationale.less' : 'history.rationale.more')}
      </Button>
    </div>
  );
}
