// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AUDIT_METADATA_KEYS, type AuditMetadataKey } from './audit.ts';

/**
 * The serialised metadata of one audit row may not be longer than this many bytes (E04-S09).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const AUDIT_METADATA_MAX_BYTES = 2048;

/** Longest list of ids one metadata value may hold. */
const MAX_LIST = 100;

/** Enum-like codes and hex digests: lower case letters, digits and `_ . : -`, 1 to 64 characters. No spaces, no `@`. */
const CODE = /^[a-z0-9_.:-]+$/;

const value = z.union([
  z.int(),
  z.boolean(),
  z.null(),
  z.array(z.int()).max(MAX_LIST),
  z.string().min(1).max(64).regex(CODE),
]);

/** What one metadata key may hold. */
type AuditMetadataValue = z.infer<typeof value>;

/** Audit metadata as callers write it: some of the closed keys, each with a value of {@link AuditMetadataValue}. */
export type AuditMetadata = Partial<Record<AuditMetadataKey, AuditMetadataValue>>;

const encoder = new TextEncoder();

/**
 * Strict: an unknown key (a personal-data key included) is an error, never silently dropped. Parse, then serialise the
 * result and not the input, so inherited or non-enumerable properties never reach the database.
 */
export const auditMetadataSchema = z
  .strictObject(Object.fromEntries(AUDIT_METADATA_KEYS.map((key) => [key, value.optional()])))
  .refine((metadata) => encoder.encode(JSON.stringify(metadata)).length <= AUDIT_METADATA_MAX_BYTES, {
    message: `audit metadata is longer than ${AUDIT_METADATA_MAX_BYTES} bytes`,
  });
