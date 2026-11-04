# Install

How to run the CLA Platform on your own server: one command builds and starts it, and a few clicks in your browser create its GitHub App. The other operator guides are linked at the end. Variables are explained in [`../configuration.md`](../configuration.md).

One instance runs per server with one GitHub App. It serves several GitHub organisations and accounts, and each installation of the App is one tenant ([several organisations](#serving-several-organisations)).

## What you need

- A Linux server that runs Docker: Docker Engine with the Compose v2 plugin (`docker compose version` must print a version). The stack was built and tested with Docker 29. Nothing else is installed on the host except `git`; Node, Yarn and PostgreSQL all run in containers.
- A DNS name that points at the server, for example `cla.example.com`. Create an `A` record, and an `AAAA` record only if the server answers on that IPv6 address, because Let's Encrypt tries both.
- Ports 80 and 443 open from the internet to the server, and free on it. Port 80 serves the certificate challenge and the redirect to HTTPS. If your own proxy already holds them, read [reverse-proxy.md](reverse-proxy.md) first.
- Outbound HTTPS from the server to `github.com`, `api.github.com` and, with the bundled proxy, Let's Encrypt.
- A GitHub account that will own the App: your own account, or an organisation where you are an owner.

The image is built on your server from the checkout. It is never downloaded from a registry, and nothing you run here pushes an image anywhere. That is also why the first start takes a few minutes: it installs the dependencies and compiles the server and the web app.

## The stack

`docker compose` starts three services, in this order, and a fourth if you ask for it.

| Service | What it does |
|---|---|
| `postgres` | PostgreSQL 18. On the first start of an empty volume it creates the database `cla`, the roles `cla_owner` and `cla_app` and the `pgboss` schema, with the passwords from `secrets/`. Not reachable from outside the stack |
| `migrate` | Runs once and stops: applies the SQL migrations and creates the job queues, as `cla_owner`. If it fails, `app` does not start |
| `app` | The server and the web app on one origin. It holds the `cla_app` credential, never the owner's. It listens on `127.0.0.1:3000` of the host by default |
| `caddy` | Only with the profile `tls`: the reverse proxy that gets and renews the certificate ([reverse-proxy.md](reverse-proxy.md)) |

## Install

Run these as a user who may use Docker, on the server.

1. Get the source.

   ```sh
   git clone https://github.com/Axiumine/cla-gate.git
   cd cla-gate
   ```

   If you run a fork, clone the fork and set `SOURCE_URL` in `.env` to its address (step 3).

2. Create the secrets and the settings file.

   ```sh
   sh scripts/init-secrets.sh
   ```

   It creates `secrets/` (mode 0700) with a generated password for each database role, the session secret and the setup token, the two connection strings built from those passwords, and empty files for the credentials the GitHub App will give you. It also copies `.env.example` to `.env`. It prints the names of the files it created and never a value, and it never changes a file that exists, so it is safe to run again after an upgrade. The setup token is in `secrets/setup_token`; you need it in step 5.

   Keep `secrets/` and `.env` out of version control (both are in `.gitignore`) and out of any image: the container receives each secret as a read-only file.

3. Edit `.env`. Only one setting is required:

   ```sh
   PUBLIC_BASE_URL=https://cla.example.com
   ```

   It is the address people and GitHub reach the server on: `https://`, host name only, no path. The server refuses to start with anything else. Set `ACME_EMAIL` to an address Let's Encrypt may send expiry notices to (optional). Every other line has a safe default; [`../configuration.md`](../configuration.md) explains them.

4. Build and start, with the bundled proxy.

   ```sh
   SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d
   ```

   `SOURCE_COMMIT` should always be set, see [Why `SOURCE_COMMIT`](#why-source_commit). Without your own proxy this is the command; with one, leave out `--profile tls` ([reverse-proxy.md](reverse-proxy.md)). Wait until it returns, then check that the stack is up:

   ```sh
   docker compose --profile tls ps -a
   curl -fsS https://cla.example.com/readyz
   ```

   `postgres` and `app` are `healthy`, `migrate` is `exited (0)`, and `/readyz` answers `{"status":"ready"}`. The first request after the first start can take a few seconds while Caddy obtains the certificate. If something fails, see [troubleshooting.md](troubleshooting.md).

   Add the line `COMPOSE_PROFILES=tls` to `.env` now. Compose then includes Caddy in every command you type, `docker compose up -d` and `docker compose down` among them. Without it, a `down` that does not name the profile removes `app` and `postgres` and leaves Caddy running, and the commands in the next steps would forget it.

5. Open `https://cla.example.com/setup`. While no GitHub App is configured the server runs in setup mode, and this page is the only way in. Paste the token from `secrets/setup_token` (`cat secrets/setup_token`), then choose whether the App belongs to your personal account or to an organisation, name it, and decide whether other organisations may install it ([several organisations](#serving-several-organisations)). "Create the GitHub App on GitHub" takes you to GitHub, which asks you to confirm and brings you back.

6. On the credentials screen click "Get the credentials". The page shows them once and the server keeps none of them, so save them now:

   - `GITHUB_APP_ID` and `GITHUB_CLIENT_ID` are public values. Put them on their lines in `.env`.
   - The webhook secret, the client secret and the private key are secrets. Each has a "Download" button that saves a file named like its target. Install the three files with mode 0444, replacing the empty placeholders:

     ```sh
     install -m 0444 ~/Downloads/github_webhook_secret secrets/github_webhook_secret
     install -m 0444 ~/Downloads/github_client_secret secrets/github_client_secret
     install -m 0444 ~/Downloads/github_app_private_key secrets/github_app_private_key
     ```

   Use `install` and not a redirect or `cp`: the files are read-only for everybody, so only a new file can replace them. If you lose the page before saving, it cannot be shown again: on GitHub, the App's settings page generates a new client secret and a new private key and lets you set a new webhook secret, which you then write to the same files.

7. Restart so that the server reads them. Run the same command again, with the commit:

   ```sh
   SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d
   ```

   `up -d` re-creates only the services whose settings changed, here `app`, which now finds all five GitHub values and starts in normal mode (the log line `config.mode` says so). `/setup` answers `404` from now on. If one of the five GitHub values is missing or empty, the start-up message names each missing one ([troubleshooting.md](troubleshooting.md)).

   The setup token is no longer needed. The server ignores it with a warning in the log; to silence the warning, replace the file with an empty one: `install -m 0444 /dev/null secrets/setup_token`.

8. Install the App. The credentials screen ended with an install link, `https://github.com/apps/<slug>/installations/new`. Open it as an owner of each organisation (or account) that should use the CLA platform, and choose the repositories. The server finds the new installation through GitHub's webhook, and a periodic sweep catches any it missed.

You are done. The server is at `https://cla.example.com`, the footer of every page links to the source of the running version, and `GET /api/meta` shows the commit.

### Why `SOURCE_COMMIT`

The platform is licensed under AGPL-3.0-only, whose section 13 obliges you to offer every user of your server the source of the version that runs. The footer of each page does this with a "Source code" link. When `SOURCE_COMMIT` is the 40-character commit the image was built from, the link points at exactly that commit in `SOURCE_URL` (if you changed the code, push it where `SOURCE_URL` points). When it is unset, empty or `unknown`, the link goes to the repository itself and the footer shows no commit, which is true only if you run the head of that repository.

Compose builds the environment of the container from your shell and `.env` on every `up`, so the prefix `SOURCE_COMMIT=$(git rev-parse HEAD)` belongs on every command that creates or re-creates `app`, not only the first. Without it the next `docker compose up -d` re-creates `app` with `unknown`. You can put the value in `.env` instead, if you update it at each upgrade.

### Settings and secrets change differently

A change in `.env` is part of the container's definition: run `docker compose up -d` (with the prefix above) and compose re-creates `app`. A change in a file of `secrets/` is read when the process starts and is not part of the definition: replace the file with `install`, then run `docker compose restart app`. The distinction is repeated in [key-rotation.md](key-rotation.md).

## Serving several organisations

One server can serve many organisations. How depends on two independent choices.

**Public or private App.** The checkbox "Let other organisations install this App" decides. A private App can be installed only by the account that owns it, which is the right choice for one organisation, and GitHub itself refuses everybody else. A public App can be installed by any GitHub account, which is needed to serve a second organisation. You can change the visibility later under the App's settings on GitHub (Advanced).

**The instance's admission policy.** GitHub does not decide which organisations may use your server; you do, with `GITHUB_ALLOWED_ACCOUNT_IDS`. The account that owns the App is always served. Any other installation is recorded as rejected and then ignored: no token is minted, no repository is listed and no pull request data is read, and its webhooks are answered `202` with `installation_not_admitted`. The log has one `installation.rejected` warning. To admit an organisation:

1. Find its numeric account id, which is not its name: `curl -s https://api.github.com/orgs/<login>` has `"id"`. Use `/users/<login>` for a personal account.
2. Add it to `.env`, comma separated, at most 100 ids and no logins: `GITHUB_ALLOWED_ACCOUNT_IDS=1234567,7654321`.
3. Run `SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d`. The reconciliation that follows the start admits the installation.

Removing an id works the same way and takes effect at the restart: the organisation's installation is refused from then on and recorded as `policy_changed`. Its data stays in the database, untouched and invisible.

**An organisation that is admitted but has not installed the App.** Listing an id creates nothing. Until an owner of that organisation installs the App, the platform holds no record of it: it is not a tenant, nothing about it is stored, its pull requests get no `license/cla` check, and the operator list (`GET /api/operator/installations`) does not show it. People of that organisation can sign in with GitHub like anybody else, but they see no organisation of it, because none exists. The install link is the one you saw in step 8; `GET /api/meta` returns it as `installUrl`, and the empty state of the dashboard (its screens arrive with E18) will point to it. When the owner installs the App, GitHub sends an `installation` webhook, the platform checks the id against your list and, if it is on it, the organisation becomes a tenant. Its repositories start disabled until the organisation's maintainers enable them.

The opposite case is an organisation that installs a public App without being admitted: GitHub shows the App as installed, and the platform ignores it as described above. Tell its owners to ask you for admission.

`OPERATOR_GITHUB_IDS` names the people who may list the installations. When the App belongs to a personal account that person is the operator; when it belongs to an organisation, set the variable to the numeric ids of the people who operate the instance.

## Trying it on your own machine

For a first look without DNS, set `PUBLIC_BASE_URL=https://localhost` and start with the profile. Caddy then issues the certificate from its own certificate authority, which your browser does not trust until you accept it. GitHub cannot reach `localhost`, so the webhook is registered as inactive and pull requests will not be checked: this shows you the setup flow and the pages, not the product at work.

## Where to go next

| Guide | Read it when |
|---|---|
| [reverse-proxy.md](reverse-proxy.md) | You bring your own proxy, or want to know what the bundled one does |
| [backup-restore.md](backup-restore.md) | Before the first signature: set up the daily backup |
| [upgrade.md](upgrade.md) | A new version is out |
| [key-rotation.md](key-rotation.md) | A secret leaked, or on a schedule |
| [troubleshooting.md](troubleshooting.md) | Something does not start or does not work |
| [data-protection.md](data-protection.md) | You are the controller of your contributors' data |
| [uninstall.md](uninstall.md) | You stop running the platform |
