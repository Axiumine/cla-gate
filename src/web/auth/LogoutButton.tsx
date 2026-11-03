// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { useLogout } from './use-logout.ts';

/**
 * "Log out" (E17-S08). While the request is under way the button is busy and ignores clicks, and keeps focus. A failure is
 * shown next to it as an error banner with the request id; nothing is cleared, so the person is still logged in.
 */
export function LogoutButton() {
  const t = useT();
  const logout = useLogout();
  return (
    <>
      <Button variant="secondary" loading={logout.isPending} onClick={logout.run}>
        {t('auth.logout')}
      </Button>
      {logout.error === null ? null : <ErrorState variant="banner" error={logout.error} />}
    </>
  );
}
