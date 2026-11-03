// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What the rest of the app imports to talk to the API (E17-S04). A Knip production entry until the auth layer (E17-S08)
// imports the client from production code; then remove the entry from knip.json.
export { type ApiClient, type ApiClientOptions, type CallOptions, createApiClient } from './client.ts';
export { ApiError, ContractError, type ContractPart, NetworkError } from './errors.ts';
export type { CsrfSource, FetchFunction } from './exchange.ts';
export { createQueryClient } from './query-client.ts';
