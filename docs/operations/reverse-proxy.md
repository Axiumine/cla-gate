# Reverse proxy and TLS

The server speaks plain HTTP on one port and expects a proxy in front of it that terminates TLS. You have two ways to get one: the `tls` profile of the compose stack, which adds Caddy and needs nothing else, or your own proxy, for which this guide has a working nginx configuration. Either way two things must be right: the public address (`PUBLIC_BASE_URL`) and what the server believes about the client's address (`TRUST_PROXY`). [install.md](install.md) shows where this fits in the installation.

## The `tls` profile

```sh
SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d
```

adds one service, `caddy`, to the stack. It publishes ports 80 (TCP) and 443 (TCP and UDP) on every interface of the host, obtains a certificate for the host name in `PUBLIC_BASE_URL` from Let's Encrypt, renews it by itself, redirects plain HTTP to HTTPS and forwards everything else to `app:3000`. Before you start it:

- `PUBLIC_BASE_URL` in `.env` is `https://` followed by a host name that already resolves to this server, with no path. The server refuses to start with anything else, and the proxy has no site to serve.
- Ports 80 and 443 are free on the host and reachable from the internet. Port 80 is needed even though people use HTTPS: the certificate challenge and the redirect use it.
- `ACME_EMAIL` may hold an address for expiry notices. Empty is allowed.

What Caddy does, and does not do, on purpose:

| Behaviour | Why |
|---|---|
| Replaces `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` with what it saw | It trusts no upstream proxy, so a client cannot choose the address the server sees |
| Sends no `Strict-Transport-Security` header | The application sends exactly one, for `https://` origins. Two would be wrong |
| Does not limit or change a request body | GitHub signs the raw body of a webhook, and may send up to 25 MiB; a changed or truncated body would fail the signature. The application has its own limit of 10 MiB for a delivery and answers `413` above it |
| Compresses responses (zstd, gzip) and removes the `Server` header | Smaller transfers, and no software name advertised. The request side is never touched |
| Keeps no access log | The application logs its own requests without addresses, and a proxy log would hold them |

The certificate and Caddy's account key live in the volumes `caddy-data` and `caddy-config`. `docker compose down` keeps them and so does an upgrade; `docker compose down -v` deletes them. Let's Encrypt allows only a few certificates for the same name per week, so do not recreate the volumes in a loop: a stack that is torn down with `-v` and started again several times in one week is refused new certificates until the week is over. If you test, test with `PUBLIC_BASE_URL=https://localhost`, for which Caddy issues from its own certificate authority and Let's Encrypt is not involved.

The profile starts and stops independently: `docker compose --profile tls up -d` adds only Caddy, `docker compose stop caddy` stops only it, and a plain `docker compose up` never starts it and never binds 80 or 443. Add `COMPOSE_PROFILES=tls` to `.env` once, and every `docker compose` command then includes Caddy without the flag.

Leave `TRUST_PROXY` as the stack sets it. The stack's network has a fixed subnet (`EDGE_SUBNET`, `172.30.30.0/24` by default), `TRUST_PROXY` trusts exactly that subnet, and Caddy is in it. Do not set `BIND_ADDRESS` to a public address together with the profile: the application's own port would then be reachable around the proxy.

To run a second stack on one machine, or to test, `CADDY_BIND_ADDRESS`, `CADDY_HTTP_PORT` and `CADDY_HTTPS_PORT` move the three published ports (they are in `.env.example`).

## Behind your own proxy

Leave the profile out. The application publishes `127.0.0.1:3000` on the host (`BIND_ADDRESS` and `PORT` change that), and your proxy forwards to it.

### nginx on the same host

This is a complete server configuration for `cla.example.com` with a certificate from Certbot. It passes the three checks that matter: the forwarded headers are overwritten and never appended to, the body limit is above GitHub's webhook maximum, and no second HSTS header is added.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cla.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name cla.example.com;

    ssl_certificate     /etc/letsencrypt/live/cla.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cla.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # GitHub may send webhook bodies of up to 25 MiB. Let the application be the one that refuses what is too large (it does,
    # above 10 MiB): nginx would answer 413 with a page of its own above 1 MiB unless told otherwise.
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        # Overwrite, never append: $proxy_add_x_forwarded_for would keep what the client sent.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        # An empty value drops the header, so a client's Forwarded never reaches the application.
        proxy_set_header Forwarded         "";
        proxy_set_header Connection        "";
    }
}
```

Three notes. The application sends `Strict-Transport-Security` itself, so do not add `add_header Strict-Transport-Security`. `http2 on;` needs nginx 1.25.1 or later; on an older one write `listen 443 ssl http2;` instead. Request buffering stays at its default, which is fine for webhooks: GitHub waits at most ten seconds for the answer and the application answers within eight.

With nginx on the host the compose default for `TRUST_PROXY` is right: a connection from the host to a published port reaches the container from the gateway of the stack's network, which is inside `EDGE_SUBNET`, so it is trusted and nothing outside the subnet is.

### A proxy on another host, or in front of several things

Publish the application's port on the server's private address and name that proxy, and only that proxy, in `TRUST_PROXY`:

```sh
BIND_ADDRESS=10.0.0.5
TRUST_PROXY=10.0.0.9
```

Then allow port 3000 from `10.0.0.9` only in the firewall of the server. Traffic between the two hosts is plain HTTP; use a private network or a tunnel for it. Run `SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d` to apply the change (a change in `.env` needs it, see [install.md](install.md#settings-and-secrets-change-differently)). A second proxy in front of the first (a CDN, a load balancer) is a hop more: list its addresses too, or use the hop count.

## What `TRUST_PROXY` accepts

`TRUST_PROXY` tells the server which connections to believe when they say who the client is. The rate limit counts requests per client address, so the setting decides who shares a budget with whom. The accepted forms are:

| Value | Meaning |
|---|---|
| `false` | Believe nobody. The client is the address of the connection itself. Right when nothing sits in front of the server, and the default outside the compose stack |
| `true` | Believe every hop. The client is the first address in `X-Forwarded-For`, which is whatever the outermost sender wrote. Only safe when the server cannot be reached except through a proxy that overwrites the header |
| `1`, `2`, ... | A hop count: believe that many proxies in front of the server. The client is the address that many entries from the right of `X-Forwarded-For`. Right when you know exactly how many proxies there are |
| `10.0.0.9` or `10.0.0.0/24,192.0.2.7` | A list of addresses and CIDR ranges, separated by commas. A connection from one of them is believed; the client is the first address from the right that is not on the list. A connection from anywhere else is not believed, whatever it says. Prefer this form |

Anything else is a start-up error naming `TRUST_PROXY` (a typo never trusts everything), and so is a range with the prefix `/0`. The compose stack sets it to the stack's own subnet.

### The two ways to get it wrong

**Too narrow.** The setting does not include your proxy (`false` behind a proxy, a list that misses its address, a hop count that is too small). Every client then arrives as the address of the proxy, and all your users share one rate limit of 600 requests a minute and one of 20 login starts a minute. The first sign is `429 too_many_requests` for people who did nothing, at the busiest hours. While the setting is `false` the log also has the warning `trust_proxy_suspected`, at most once a minute, whenever a request arrives with `X-Forwarded-For` or `Forwarded`.

**Too wide.** The setting believes a connection it should not: `true` while the port is reachable directly, a CIDR range that includes untrusted machines, a hop count that is too large. A client can then write its own `X-Forwarded-For` and choose the address the server counts. Rate limits stop limiting, and so does the throttle on webhook deliveries with a bad signature. Nothing logs it, because the address is neither logged nor stored.

### Verify the setting

Do this after every change of the proxy or of `TRUST_PROXY`. Every response of `/healthz` carries `x-ratelimit-remaining`, the requests left in the minute for the client address the server believes.

1. One client, three requests. The number goes down by one each time:

   ```sh
   for i in 1 2 3; do curl -s -o /dev/null -D - https://cla.example.com/healthz | grep -i '^x-ratelimit-remaining'; done
   ```

2. A second client, from another network (a phone on mobile data will do), runs the same command. Its first number must be close to 600 again. If it continues the count of the first client (it is lower by the requests the first one made), the two share one address: the setting is too narrow.

3. One client, two requests with invented addresses:

   ```sh
   for ip in 203.0.113.7 203.0.113.8; do curl -s -o /dev/null -D - -H "X-Forwarded-For: $ip" https://cla.example.com/healthz | grep -i '^x-ratelimit-remaining'; done
   ```

   The second number must be lower than the first: the proxy replaced the invented address with the real one. If both numbers are close to 600, a client chooses its own address: the setting or the proxy is too wide.

4. `docker compose logs app | grep trust_proxy_suspected` prints nothing.

If step 2 or 3 fails, fix the proxy first (it must overwrite `X-Forwarded-For`, as the examples here do) and then `TRUST_PROXY`. More symptoms and fixes are in [troubleshooting.md](troubleshooting.md).
