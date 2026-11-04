# Uninstall

There are three different things people call uninstalling: stopping the platform for a while, removing it from a server for good, and ending the GitHub App. They do not have the same consequences, and two of them cannot be undone. Read the section for the one you mean.

Signatures are legal evidence. Before you remove anything that holds them, decide who keeps the evidence and for how long, and make that copy ([backup-restore.md](backup-restore.md)).

## Stop, keep everything

```sh
docker compose --profile tls down
```

removes the containers and the networks. It keeps the volumes (`cla-postgres-data` with the database, `caddy-data` and `caddy-config` with the certificate), `secrets/`, `.env` and the image. `docker compose --profile tls up -d` starts the same platform again with the same data. Without the profile flag, `down` leaves the Caddy container running, so give the flag to every command, or set `COMPOSE_PROFILES=tls` in `.env` ([reverse-proxy.md](reverse-proxy.md)).

While the platform is stopped, GitHub's deliveries fail and pull requests get no check. Required checks wait. Read [what the organisations see](#what-the-organisations-see) before you stop it for long.

## Remove the data

```sh
docker compose --profile tls down -v
```

also deletes the volumes. **This destroys the database: every signature, every CLA version, the audit log and the job queue, and with them the evidence that people agreed to your CLA.** It deletes the certificate too. There is no undo, and nothing in the platform keeps a second copy.

Export first, and check what you exported:

1. Take a dump of the database and verify it ([backup-restore.md](backup-restore.md)). It is the complete copy, and the only one that can be restored.
2. Have the administrators of each organisation download the signatures of every CLA document as CSV, while the platform still runs. It is a readable copy for people who will never restore a dump. The route is `GET /api/installations/:installationId/documents/:documentId/signatures.csv`, which the dashboard offers to organisation administrators.
3. Store both where the organisation's lawyers say, encrypted, with an owner and a date at which they are deleted. A dump of a platform that you took offline is still personal data: [data-protection.md](data-protection.md) applies to it as long as it exists.

## Remove the platform from the server

In this order, because the first steps are the ones that keep other people's pull requests from being stuck:

1. **Tell the organisations,** and ask their administrators to remove the required check `license/cla` from their branch protection rules and rulesets. A required check that nobody reports stays "expected" for ever and blocks merging.
2. **Export** as above, then take a final dump.
3. **End the GitHub App** (next section).
4. **Remove the stack:**

   ```sh
   docker compose --profile tls down -v
   docker image rm cla-gate:local
   ```

   then delete the checkout, including `secrets/` and `.env`, and the backups you are not keeping. Remove the DNS record. `docker builder prune` frees the build cache.

## End the GitHub App

On GitHub, open the settings of the account or organisation that owns the App, Developer settings, GitHub Apps, choose the App, and under Advanced use "Delete GitHub App". Deleting it removes it from every account that installed it, revokes its private keys and client secrets, and ends the authorizations that people gave it when they signed in. GitHub stops sending webhooks at once.

If you only want the platform to leave one organisation, that organisation's owners uninstall the App under Settings, Applications, Installed GitHub Apps. The platform marks the installation deleted when it learns of it, keeps its rows (signatures cannot be deleted), and stops serving it. The other organisations are not affected.

A private App that is deleted cannot be restored. If there is any chance you will run the platform again, stop it ([above](#stop-keep-everything)) instead and keep the App.

## What the organisations see

- **New pull requests get no `license/cla` check and no comment.** The App is gone, or the server is.
- **A required check keeps pull requests unmergeable** until an administrator removes it from the rules. This is the most important thing to say before you uninstall.
- **Checks already posted stay** on the commits and pull requests where they were created, as the history of what was decided. A check that was `in_progress` at that moment is never completed.
- **The sign link of a contributor stops working,** and with it the way to sign. People who already signed have no page to look at and nobody to ask for their data except you.
- **The dashboard is gone,** and with it the signature export, so the CSV files you made earlier are the only readable copy the maintainers have.

If someone asks you for their data or for its erasure after the platform is gone, you are still the controller of what is in your backups ([data-protection.md](data-protection.md#after-a-restore)).
