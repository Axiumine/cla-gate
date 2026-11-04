// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import http from 'node:http';
import https from 'node:https';

// E19-S12: a request to a stack as the TLS scenario needs it. `fetch` joins repeated headers into one and cannot trust a
// certificate of its own, so the two things this scenario asserts (exactly one Strict-Transport-Security header, over a
// connection that trusts Caddy's root certificate) go through node:http and node:https. The connection is made to a loopback
// address and the name the certificate is for goes in the Host header and the TLS server name.

const TIMEOUT_MS = 10_000;

/** What `http.request` and `https.request` both are, as far as this file uses them. */
type Transport = (
  url: URL,
  options: https.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

/** The two ways to reach a server, by protocol; the tests of this file put their own in. */
export const TRANSPORTS: Readonly<Record<'http' | 'https', Transport>> = {
  http: http.request,
  https: https.request,
};

export interface RawReply {
  readonly status: number;
  /** Every header line as the server sent it, name and value, in order; a header sent twice is two entries. */
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

export interface RawOptions {
  /** The host name the site answers to (`localhost`): the Host header, and for HTTPS the name the certificate must match. */
  readonly host: string;
  /** PEM of the one certificate authority to trust, instead of Node's own list. HTTPS only. */
  readonly ca?: string;
  /** How long to wait for the answer; ten seconds when missing. */
  readonly timeoutMs?: number;
}

/** The values of a header, whatever the case of its name; one entry per time the server sent it. */
export function headerValues(reply: RawReply, name: string): string[] {
  const wanted = name.toLowerCase();
  return reply.headers.filter(([key]) => key.toLowerCase() === wanted).map(([, value]) => value);
}

/** `["a", "1", "b", "2"]` as `[["a", "1"], ["b", "2"]]`: the flat list Node keeps of the header lines, names and values alternating. */
function pairs(flat: readonly string[]): [string, string][] {
  const result: [string, string][] = [];
  let name: string | undefined;
  for (const item of flat) {
    if (name === undefined) {
      name = item;
    } else {
      result.push([name, item]);
      name = undefined;
    }
  }
  return result;
}

/**
 * A `GET` of `target` (an `http://` or `https://` address), redirects not followed. With `ca`, HTTPS trusts that authority and no
 * other; without it, what Node trusts, so a certificate of a private authority is refused with an error.
 */
export function getRaw(target: string, options: RawOptions, transports = TRANSPORTS): Promise<RawReply> {
  const url = new URL(target);
  const secure = url.protocol === 'https:';
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const transport = secure ? transports.https : transports.http;
    const request = transport(
      url,
      {
        method: 'GET',
        headers: { host: options.host },
        timeout: timeoutMs,
        ...(secure ? { servername: options.host, ...(options.ca === undefined ? {} : { ca: options.ca }) } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            // a client response always has its status code; `Number(undefined)` is NaN, which no check of a status would match
            status: Number(response.statusCode),
            headers: pairs(response.rawHeaders),
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`no answer from ${url.origin} within ${timeoutMs} ms`));
    });
    request.on('error', reject);
    request.end();
  });
}
