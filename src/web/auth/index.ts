// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What the screens import to know who is logged in and to log in and out (E17-S08). A Knip production entry until the screens
// of E18 import these exports from production code; then remove the entry from knip.json.
export { Avatar, type AvatarProps } from './Avatar.tsx';
export { useApiClient, useSession } from './hooks.ts';
export { LoginLink, type LoginLinkProps } from './LoginLink.tsx';
export { LogoutButton } from './LogoutButton.tsx';
export { buildReturnTo, loginStartUrl } from './return-to.ts';
export { SessionEndedBanner } from './SessionEndedBanner.tsx';
export { avatarUrlSchema, type Session, type SessionUser } from './session.ts';
export { UserMenu } from './UserMenu.tsx';
