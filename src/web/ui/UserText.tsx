// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { clipText, visibleText } from './user-text.ts';

export interface UserTextProps {
  /** The string a person controls: a login, a name, a repository name, a rationale. Shown as text, and never changed. */
  readonly children: string;
  /**
   * The most characters shown (a whole number of at least 1). A longer text is cut there and ends in an ellipsis; the whole
   * text stays in the page for assistive technology.
   */
  readonly maxLength?: number;
}

/**
 * The one door for a string that a person controls (E17-S11). It is a React text node inside `<bdi>`: React escapes it, so
 * markup in it is shown as the characters it is made of, and `<bdi>` isolates its direction, so a right-to-left name cannot
 * reorder the text around it. `overflow-wrap: anywhere` lets a long word with no space break, so one name cannot widen the
 * page. Controls and bidirectional formatting characters are written out as `<U+XXXX>` instead of acting. Nothing here reads
 * markdown or HTML, and nothing here sets markup.
 *
 * With `maxLength`, a longer text is cut and ends in an ellipsis, which is hidden from assistive technology together with the
 * cut text; the whole text follows in a visually hidden node, so a screen reader still announces all of it.
 */
export function UserText({ children, maxLength }: UserTextProps) {
  const shown = visibleText(children);
  const clipped = maxLength === undefined ? null : clipText(children, maxLength);
  if (clipped === null) {
    return <bdi className="wrap-anywhere">{shown}</bdi>;
  }
  return (
    <bdi className="wrap-anywhere">
      <span aria-hidden="true">{clipped}</span>
      <span className="sr-only">{shown}</span>
    </bdi>
  );
}
