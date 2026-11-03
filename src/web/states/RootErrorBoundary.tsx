// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Component, type ReactNode } from 'react';
import { SourceFooter } from '../layout/SourceFooter.tsx';
import { CrashFallback } from './CrashFallback.tsx';
import { logCrash } from './crash-log.ts';

interface BoundaryProps {
  readonly children: ReactNode;
}

/** `failed` is separate from `error` because anything can be thrown, `undefined` included. */
interface BoundaryState {
  readonly failed: boolean;
  readonly error: unknown;
}

/**
 * The last net of the app (E17-S07): a render error anywhere below it shows the fallback, a "Reload" button and the request
 * id when the error has one, instead of a blank page. It logs the name of the error and the request id to the console and
 * reports nothing anywhere. The source footer (E17-S09) is part of the fallback, and the shell keeps its own outside the
 * route boundaries, so the offer of the source outlives a crash. It is a class because React has no hook for catching a
 * render error.
 */
export class RootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown): void {
    logCrash(error);
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <>
        <main className="mx-auto max-w-2xl p-6">
          <CrashFallback error={this.state.error} />
        </main>
        <SourceFooter />
      </>
    ) : (
      this.props.children
    );
  }
}
