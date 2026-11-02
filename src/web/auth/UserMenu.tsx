// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useLocation } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { Avatar } from './Avatar.tsx';
import { useSession } from './hooks.ts';
import { LoginLink } from './LoginLink.tsx';
import { LogoutButton } from './LogoutButton.tsx';
import { returnPathOf } from './return-to.ts';

/**
 * The user menu (E17-S08): the avatar and "Log out" for someone logged in, "Log in with GitHub" for anyone else, and nothing
 * until the server has said which. The shell of E17-S09 puts it in the header and adds the login and the theme toggle.
 */
export function UserMenu() {
  const t = useT();
  const session = useSession().data;
  const location = useLocation();
  if (session === undefined) {
    return null;
  }
  if (!session.authenticated) {
    return <LoginLink returnTo={returnPathOf(location.pathname, location.searchStr)}>{t('auth.login')}</LoginLink>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar login={session.user.login} avatarUrl={session.user.avatarUrl} />
      <LogoutButton />
    </div>
  );
}
