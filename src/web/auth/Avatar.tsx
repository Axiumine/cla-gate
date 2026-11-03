// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { classNames } from '../ui/class-names.ts';

export interface AvatarProps {
  /** The login, for the initials shown when there is no picture. */
  readonly login: string;
  /** The picture, already checked by `avatarUrlSchema`: an address on GitHub's avatar host over HTTPS, or `null`. */
  readonly avatarUrl: string | null;
}

const SIZE = 'h-8 w-8 shrink-0 rounded-full';

/** The first two characters of the login, upper case; whole characters, so an emoji is never cut in half. */
function initialsOf(login: string): string {
  return Array.from(login).slice(0, 2).join('').toUpperCase();
}

/**
 * The picture of the logged-in person (E17-S08), or their initials when there is none. It is decoration: the login beside it
 * says who it is, so the picture has an empty `alt` and the initials are hidden from assistive technology.
 */
export function Avatar({ login, avatarUrl }: AvatarProps) {
  if (avatarUrl !== null) {
    return <img src={avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" className={SIZE} />;
  }
  return (
    <span
      aria-hidden="true"
      className={classNames(
        SIZE,
        'inline-flex items-center justify-center bg-surface-muted text-sm font-medium text-fg',
      )}
    >
      {initialsOf(login)}
    </span>
  );
}
