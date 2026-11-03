// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The states of a request and the error boundaries (E17-S07). A Knip production entry until the router (E17-S08) and the
// screens of E18 import these exports from production code; then remove the entry from knip.json.
export { EmptyState, type EmptyStateProps } from './EmptyState.tsx';
export { ErrorState, type ErrorStateProps } from './ErrorState.tsx';
export { errorMessage } from './error-message.ts';
export { LoadingState } from './LoadingState.tsx';
export { NotFoundPage } from './NotFoundPage.tsx';
export { QueryBoundary, type QueryBoundaryProps } from './QueryBoundary.tsx';
export { RootErrorBoundary } from './RootErrorBoundary.tsx';
export { RouterErrorComponent } from './RouterErrorComponent.tsx';
