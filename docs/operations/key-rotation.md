# Key and secret rotation

Every secret of the platform is a file in `secrets/` that the container reads once, when the process starts. Rotating a secret is therefore always the same three moves: put the new value in the file, restart the service that reads it, and retire the old value where it is also known (GitHub, the database). The sections below follow the order of the `SECRET_VARIABLES` list in `src/server/config/secret-files.ts`, one section for each secret, with the exact steps and the restart each one needs.

## How rotation works

**Replace the file; do not edit it.** The files are mode 0444 inside a 0700 directory, so even you cannot write to one with a redirect. Write the new value to a temporary file and install it over the old one, then remove the temporary file:

```sh
umask 077
openssl rand -hex 32 > new.tmp          # or paste a value you were given into new.tmp with your editor
install -m 0444 new.tmp secrets/session_secret
rm new.tmp
```

`install` puts a new file in place. That matters: a container that is running keeps seeing the old file until it is restarted, because a bind-mounted file is tied to the file as it was when the container started. `docker compose restart app` starts the process again and picks up the new one. The file may end with one line break; the server removes exactly one.

**Restart the right service.** `app` reads all of them except `migration_database_url`, which `migrate` reads on every `docker compose up` (it runs there and exits). `docker compose restart app` is enough for every secret except where a section says otherwise. A change to `.env` is different: it needs `docker compose up -d` ([install.md](install.md#settings-and-secrets-change-differently)).

**Check the log.** After each restart, `docker compose logs app` has a `config.mode` line (normal or setup) and the GitHub lines named below. A start-up error is plain text, one line for each variable, and names the variable, never the value ([troubleshooting.md](troubleshooting.md)).

**When a secret has leaked, retire the old value first.** The overlap windows below exist so that nothing breaks while you switch; they are a convenience, not a safeguard. Deleting a leaked key on GitHub at once costs a short outage, and that is the right price.

| Variable | File | Read by |
|---|---|---|
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_PRIVATE_KEY_PREVIOUS` | `github_app_private_key`, `github_app_private_key_previous` | `app` |
| `GITHUB_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SECRET_PREVIOUS` | `github_webhook_secret`, `github_webhook_secret_previous` | `app` |
| `GITHUB_CLIENT_SECRET` | `github_client_secret` | `app` |
| `SESSION_SECRET` | `session_secret` | `app` |
| `SETUP_TOKEN` | `setup_token` | `app` |
| `DATABASE_URL` | `database_url` | `app` |
| `MIGRATION_DATABASE_URL` | `migration_database_url` | `migrate` |

## GitHub App private key (`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_PRIVATE_KEY_PREVIOUS`)

The key signs the App's identity towards GitHub. The App can hold several keys at once, and the server can hold two: the current one and the previous one. If GitHub refuses the current key with a 401, the server tries the previous one, promotes it, and logs `github.app_key_fallback`. That is the overlap that lets you rotate with no outage.

1. On GitHub, open the App's settings, General, Private keys, and choose "Generate a private key". A `.pem` file downloads. The old key stays valid.
2. Keep the current key as the previous one:

   ```sh
   install -m 0444 secrets/github_app_private_key secrets/github_app_private_key_previous
   ```

3. Install the new key as the current one:

   ```sh
   install -m 0444 ~/Downloads/your-app.2026-11-04.private-key.pem secrets/github_app_private_key
   ```

4. Restart: `docker compose restart app`.
5. Check. `docker compose logs app | grep github.app_configured` shows `keyFingerprints`, the current key first and the previous second, as `SHA256:...` values. Compare the first with the fingerprint GitHub shows for the new key. There must be no `github.app_keys_refused` (error: GitHub refused every key) and no `github.app_key_fallback` (warning: the current key was refused and the previous one worked, so the new file is not a key of this App).
6. Delete the old key in the App's settings. Then empty the previous file and restart again, so that the server no longer holds it:

   ```sh
   install -m 0444 /dev/null secrets/github_app_private_key_previous
   docker compose restart app
   ```

The same key in both files is a start-up error naming `GITHUB_APP_PRIVATE_KEY_PREVIOUS`.

## Webhook secret (`GITHUB_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SECRET_PREVIOUS`)

GitHub signs each delivery with this secret, and the server checks the signature over the raw body. For a rotation the server accepts a delivery signed with either secret, and logs the warning `webhook.secret_previous_used` (at most once a minute) for one signed with the previous one. Change the server first and GitHub second, so that no delivery is ever refused.

1. Make the new secret (at least 16 characters; `openssl rand -hex 32` gives 64) and keep the old one:

   ```sh
   umask 077
   install -m 0444 secrets/github_webhook_secret secrets/github_webhook_secret_previous
   openssl rand -hex 32 > new.tmp
   install -m 0444 new.tmp secrets/github_webhook_secret
   rm new.tmp
   ```

2. Restart: `docker compose restart app`. The server now accepts both.
3. On GitHub, in the App's settings, General, Webhook, replace the webhook secret with the content of `secrets/github_webhook_secret` (`cat secrets/github_webhook_secret`) and save. Deliveries are signed with the new secret from now on.
4. Watch `docker compose logs app | grep webhook.secret_previous_used`. When the warning has not appeared for a while (a delivery is signed when GitHub sends it, so a few minutes is enough) and "Recent Deliveries" on GitHub show 2xx, empty the previous file and restart:

   ```sh
   install -m 0444 /dev/null secrets/github_webhook_secret_previous
   docker compose restart app
   ```

A secret equal to the previous one is a start-up error naming the variable. If you did step 3 before step 2, deliveries are refused with `401 webhook_signature_invalid` until the restart; GitHub's "Redeliver" brings them back.

## Client secret (`GITHUB_CLIENT_SECRET`)

The client secret is what the server shows GitHub when it exchanges the code of a sign-in. GitHub lets the App hold a second one while you switch.

1. On GitHub, in the App's settings, General, Client secrets, choose "Generate a new client secret". Copy it; GitHub shows it once.
2. Put it in a temporary file with your editor (`umask 077; ${EDITOR:-vi} new.tmp`), then:

   ```sh
   install -m 0444 new.tmp secrets/github_client_secret
   rm new.tmp
   ```

3. Restart: `docker compose restart app`.
4. Sign in to the platform once with GitHub to prove the new secret works.
5. Delete the old client secret in the App's settings.

Nobody is signed out: sessions live in the database, and the platform stores no GitHub token of any user. A person who is in the middle of a sign-in at the moment of the restart sees the login-failed page and starts again.

## Session secret (`SESSION_SECRET`)

The session secret signs the cookie that carries a sign-in from the login start to the callback, and derives the CSRF token of every session. There is no overlap window: the new value is the only one from the restart on. It needs at least 32 characters.

1. Make and install it: `openssl rand -hex 32 > new.tmp`, `install -m 0444 new.tmp secrets/session_secret`, `rm new.tmp`.
2. Restart: `docker compose restart app`.

What users notice:

- Nobody is signed out. The session cookie is a random identifier that the server looks up in the database; it is not signed with this secret.
- Every CSRF token issued before the restart is refused. A page that was open keeps working for reading, and its next change (saving a form) fails with "Your session could not be verified. Reload the page and try again." The reload gets a new token.
- A sign-in that was started and not finished (its cookie lives ten minutes) fails and must be started again.

If the secret leaked, nobody can use it to take over a session, but it lets an attacker forge those two cookies, so rotate. If you also want every person to sign in again, delete the sessions after the restart:

```sh
docker compose exec -T postgres psql -U cla_owner -d cla -c "delete from sessions"
```

## Setup token (`SETUP_TOKEN`)

The setup token unlocks `/setup` while no GitHub App is configured, and the server ignores it afterwards, with a warning at start-up. Rotate it if it leaked before the App was created: write a new value to `secrets/setup_token` as above (at least 32 characters) and restart `app`; the unlocked sessions of the setup page end with the process. After the setup you can empty the file so that the warning stops: `install -m 0444 /dev/null secrets/setup_token`, and restart.

## Database role passwords (`DATABASE_URL`, `MIGRATION_DATABASE_URL`)

The two connection strings carry the passwords of the roles `cla_app` (`database_url`, used by `app`) and `cla_owner` (`migration_database_url`, used by `migrate`). The passwords themselves are set in the database by the provisioning script, from `secrets/db_app_password` and `secrets/db_owner_password`. Changing the files does not change the roles: the script has to run again. This is the whole sequence, and it works because `init-secrets.sh` creates only what is missing:

```sh
rm secrets/db_owner_password secrets/db_app_password secrets/database_url secrets/migration_database_url
sh scripts/init-secrets.sh
docker compose restart postgres
docker compose exec -T -e PGUSER=postgres postgres sh /docker-entrypoint-initdb.d/10-provision-database.sh
docker compose restart app
```

1. The first two lines generate new passwords and rebuild both connection strings from them. If you choose your own passwords, write the two `db_*` files and the two URL files yourself (a password goes into a URL: letters, digits and `. _ ~ -` need no encoding, anything else must be percent-encoded).
2. `restart postgres` makes the container see the new files. It takes a few seconds; `app` normally reconnects by itself, and if `/readyz` stays 503, restarting `app` settles it.
3. The script runs inside the container, as the administrator, and sets both passwords. It prints `role cla_owner password: set` and `role cla_app password: set`, and `unchanged` for everything else. Run without `-e PGUSER=postgres` it fails: the container has no role named after the user who runs the command.
4. `restart app` makes the server use the new `database_url` at once. Between steps 3 and 4 the connections that `app` already has keep working and a new one is refused, so do not wait. `migrate` reads its URL the next time you run `docker compose up`.

Check: `docker compose logs app` has no `database: cannot connect` line and `curl -fsS https://cla.example.com/readyz` answers 200.

The password in `secrets/db_admin_password` belongs to the `postgres` superuser and is used only when the volume is first created. Changing the file afterwards does not change the password; to change it, run `\password postgres` in `docker compose exec postgres psql -U postgres` and write the same value to the file.

On a PostgreSQL server of your own, run `scripts/provision-database.sh` with `CLA_OWNER_PASSWORD_FILE` and `CLA_APP_PASSWORD_FILE` pointing at the new password files (the administrator comes from `PGHOST`, `PGUSER` and the other libpq variables), write the two connection strings, and restart `app`.
