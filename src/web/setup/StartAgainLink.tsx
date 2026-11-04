// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { SETUP_PATH } from '../../shared/routes.ts';
import { useT } from '../i18n/index.ts';

/**
 * A link back to the first step of the setup (E19-S07). It loads the page again (`reloadDocument`) and does not route inside
 * the app: a reload is what leaves nothing of the step that failed behind in memory, the unlocked session and any
 * credentials included.
 */
export function StartAgainLink() {
  const t = useT();
  return (
    <Link to={SETUP_PATH} reloadDocument className="underline underline-offset-2">
      {t('setup.startAgain')}
    </Link>
  );
}
