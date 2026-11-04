// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { convertResponseSchema } from '../../shared/setup.ts';

// The five credentials of the conversion as the credentials screen lists them (E19-S07): what each is called, what it
// holds, and the file it is saved as.

type Converted = z.infer<typeof convertResponseSchema>;

/** One value to hand to the operator. */
export interface CredentialItemData {
  /** What the field is called: the variable of the `.env` file for a public value, the file in `secrets/` for a secret. */
  readonly label: string;
  readonly value: string;
  /** A secret is masked until "Reveal". */
  readonly secret: boolean;
  /** Needs a text area: a value of several lines (the private key). */
  readonly multiline: boolean;
  /**
   * The name of the file "Download" saves. A secret is saved as the file it belongs in; a public value, which belongs on a
   * line of the `.env` file, is saved under the name of its variable.
   */
  readonly fileName: string;
  /** What "Download" saves: the value itself for a secret, the `NAME=value` line for a public value. */
  readonly content: string;
}

function publicItem(name: string, value: string): CredentialItemData {
  return { label: name, value, secret: false, multiline: false, fileName: name, content: `${name}=${value}\n` };
}

function secretItem(file: string, value: string, multiline: boolean): CredentialItemData {
  return { label: `secrets/${file}`, value, secret: true, multiline, fileName: file, content: value };
}

/** The two public values, for the `.env` file. */
export function publicItems(converted: Converted): readonly CredentialItemData[] {
  return [publicItem('GITHUB_APP_ID', String(converted.appId)), publicItem('GITHUB_CLIENT_ID', converted.clientId)];
}

/** The three secrets, one file each. */
export function secretItems(converted: Converted): readonly CredentialItemData[] {
  return [
    secretItem('github_client_secret', converted.clientSecret, false),
    secretItem('github_webhook_secret', converted.webhookSecret, false),
    secretItem('github_app_private_key', converted.privateKeyPem, true),
  ];
}
