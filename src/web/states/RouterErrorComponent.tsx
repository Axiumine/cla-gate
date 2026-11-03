// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { CrashFallback } from './CrashFallback.tsx';
import { logCrash } from './crash-log.ts';

/**
 * The `errorComponent` of the router (E17-S07): a route whose loader or component throws shows the crash fallback inside the
 * page, not a blank one. Same fallback and same log as the root boundary (the name and the request id, nothing else). The
 * router's `reset` is not offered: "Reload" loads the page again from the server, which also clears whatever state caused it.
 */
export function RouterErrorComponent({ error }: Readonly<ErrorComponentProps>) {
  useEffect(() => {
    logCrash(error);
  }, [error]);
  return <CrashFallback error={error} />;
}
