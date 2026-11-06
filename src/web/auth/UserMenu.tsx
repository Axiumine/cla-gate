// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useLocation } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { OperatorLink } from '../operator/OperatorLink.tsx';
import { ThemeToggle } from '../theme/index.ts';
import { UserText } from '../ui/UserText.tsx';
import { Avatar } from './Avatar.tsx';
import { useSession } from './hooks.ts';
import { LoginLink } from './LoginLink.tsx';
import { LogoutButton } from './LogoutButton.tsx';
import { returnPathOf } from './return-to.ts';
import type { SessionUser } from './session.ts';

/** Who is logged in: the avatar, the login as user text, the "Operator" link for the operator of the instance (E18-S13), and "Log out". The numeric id is never shown. */
function Account({ user }: { readonly user: SessionUser }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar login={user.login} avatarUrl={user.avatarUrl} />
      <span className="text-sm">
        <UserText>{user.login}</UserText>
      </span>
      <OperatorLink />
      <LogoutButton />
    </div>
  );
}

/**
 * The user menu in the header of the shell (E17-S09). Someone who is logged in sees their avatar and `login` (shown through
 * `UserText`, never the numeric id), the theme toggle and "Log out"; anyone else sees the theme toggle and "Log in with
 * GitHub", which returns to the page they are on. Nothing but the toggle is shown until the server has said which. The
 * theme belongs to the browser, not to the account, so the toggle is there for a visitor too.
 */
export function UserMenu() {
  const t = useT();
  const session = useSession().data;
  const location = useLocation();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ThemeToggle />
      {session?.authenticated === true ? <Account user={session.user} /> : null}
      {session?.authenticated === false ? (
        <LoginLink returnTo={returnPathOf(location.pathname, location.searchStr)}>{t('auth.login')}</LoginLink>
      ) : null}
    </div>
  );
}
