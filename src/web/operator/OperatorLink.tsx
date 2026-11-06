// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { useOperator } from './use-operator.ts';

/**
 * The "Operator" link of the user menu (E18-S13). It is there only once the endpoint has answered `200`: while the answer is awaited,
 * for anyone it answered `404`, and when the request failed, there is nothing, and no error either, because the menu is not the page
 * that asked. The server decides who the operator is on every request; the link is a convenience and never the access control.
 */
export function OperatorLink() {
  const t = useT();
  const view = useOperator().data;
  return view?.operator === true ? (
    <Link
      to="/operator/installations"
      className="text-sm underline underline-offset-2 aria-[current=page]:font-semibold"
    >
      {t('operator.link')}
    </Link>
  ) : null;
}
