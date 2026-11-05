// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { contentHashOf } from './text-hash.ts';

export interface ContentHashProps {
  /** The text the version is made from: the saved draft. */
  readonly text: string;
}

/** The hash as it is known: not yet, computed, or not computable in this browser. */
type Hash =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly hex: string }
  | { readonly state: 'failed' };

/**
 * The SHA-256 of the text, computed in the browser with `crypto.subtle.digest` (E18-S05), shown as a preview of the fingerprint the
 * server will record for the version. It is hexadecimal that this code made, so it is a plain text node. A browser without
 * `crypto.subtle` (a page that is not a secure context) says so, and the server still records the hash.
 */
export function ContentHash({ text }: ContentHashProps) {
  const t = useT();
  const [hash, setHash] = useState<Hash>({ state: 'pending' });
  useEffect(() => {
    let current = true;
    contentHashOf(text).then(
      (hex) => {
        if (current) {
          setHash({ state: 'done', hex });
        }
      },
      () => {
        if (current) {
          setHash({ state: 'failed' });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [text]);
  if (hash.state === 'done') {
    return <code className="font-mono text-sm break-all">{`sha256:${hash.hex}`}</code>;
  }
  return (
    <span className="text-fg-muted">
      {t(hash.state === 'pending' ? 'publish.hash.pending' : 'publish.hash.failed')}
    </span>
  );
}
