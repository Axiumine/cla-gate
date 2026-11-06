// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';

/** The characters of the hash that the short form shows. */
const SHORT_LENGTH = 12;

export interface FingerprintProps {
  /** `content_sha256` of the version on screen: 64 lowercase hexadecimal characters. */
  readonly sha256: string;
}

/**
 * The fingerprint of the text on screen (E18-S01): `sha256:` and the first 12 characters of the hash, the whole hash in a
 * disclosure, and the statement of what it covers. The hash is over the stored source text, the text that is signed, and not
 * over what is drawn from it. It is hexadecimal from the server's schema, so it is a plain text node.
 */
export function Fingerprint({ sha256 }: FingerprintProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {t('sign.fingerprint.label')} <code className="font-mono">{`sha256:${sha256.slice(0, SHORT_LENGTH)}`}</code>
      </p>
      <p className="text-fg-muted">{t('sign.fingerprint.covers')}</p>
      <details>
        <summary className="cursor-pointer">{t('sign.fingerprint.show')}</summary>
        <p className="mt-2">
          <code className="font-mono break-all">{`sha256:${sha256}`}</code>
        </p>
      </details>
    </div>
  );
}
