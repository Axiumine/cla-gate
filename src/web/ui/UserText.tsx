// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

export interface UserTextProps {
  /** The string a person controls: a login, a name, a repository name, a rationale. Shown exactly as it is, as text. */
  readonly children: string;
}

/**
 * The one door for a string that a person controls (E17-S09, E17-S11). It is a React text node inside `<bdi>`: React
 * escapes it, so markup in it is shown as the characters it is made of, and `<bdi>` isolates its direction, so a right-to-left
 * name cannot reorder the text around it. `overflow-wrap: anywhere` lets a long word with no space break, so one name cannot
 * widen the page. Nothing here reads markdown or HTML, and nothing here sets markup.
 */
export function UserText({ children }: UserTextProps) {
  return <bdi className="wrap-anywhere">{children}</bdi>;
}
