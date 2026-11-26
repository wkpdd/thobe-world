# Deploying to cPanel shared hosting

One command builds the store, uploads it, switches the site to it and checks
it. If the new version does not answer, the site is put back on the previous
one automatically. Any earlier version can be brought back in seconds.

```bash
npm run deploy             # build → upload → switch → verify (auto rollback)
npm run deploy:status      # what is live, what you can roll back to
npm run deploy:rollback    # back to the previous release
npm run deploy:rollback 20261126-142233-1a2b3c4d   # back to a given release
npm run deploy:check       # test the connection, change nothing
```

## How it works

The cPanel Node.js application points at a small switcher, `app.cjs`
(`deploy/bootstrap.cjs` in this repository). Each deploy uploads a complete
release next to it, with its production `node_modules` already installed for
Linux. You never press « Run NPM Install ».

```
~/thobe-world/                 ← Application root in « Setup Node.js App »
  app.cjs                      ← Application startup file (the switcher)
  CURRENT                      ← the release that should run
  GOOD                         ← the last release that passed its checks
  deploys.json                 ← every deploy and rollback: who, when, result
  releases/20261126-…/         ← the 5 newest releases that started, unpacked
  data/                        ← H47 Pay's data, photos, image cache (never replaced)
  .env                         ← optional shared settings (secrets stay on the server)
  logs/bootstrap.log           ← what the switcher did, and why a release failed
```

1. **Lock.** `DEPLOY_LOCK` stops two deploys from overlapping.
2. **Upload.** The tool uploads `app.cjs`, `release-<id>.twpkg` (about 22 MB)
   and then its sha256 checksum. A partial upload never runs, because the
   checksum must match first.
3. **Switch.** It writes `CURRENT`. The running process notices within two
   seconds and exits. Passenger then starts the switcher again, which unpacks
   the release into `releases/<id>/` and starts it. If the release does not
   load, the switcher starts `GOOD` instead, so the shop stays up.
4. **Verify.**
   - `/health` must answer `release: <id>`, not as a fallback.
   - The home page must render.
   - `/api/sync.php` must be answered by the store, so H47 Pay can still sync.
5. **Result.**
   - **Good:** `GOOD = <id>`.
   - **Bad:** `CURRENT` goes back to the previous release and the tool waits
     until it answers again. It prints the server log and exits with an error.

Orders, stock and photos live in `data/`, outside the releases. A deploy or a
rollback never touches them.

## One-time setup on cPanel

1. **cPanel → Setup Node.js App → Create Application:**
   - **Node.js version:** 22 (or 20.9 and newer)
   - **Application mode:** Production
   - **Application root:** `thobe-world`. It must be outside `public_html`.
   - **Application URL:** your domain
   - **Application startup file:** `app.cjs`
2. **Environment variables** (same page): `SITE_URL`, `NEWSTORE_SYNC_KEY` and
   `APP_SECRET`, plus any `SHOP_*` and pixel values from `.env.example`. Leave
   `DATA_DIR` unset: the switcher uses `~/thobe-world/data`.
   - Instead of setting them here, you can put a `.env` file in the
     application root.
3. **Credentials for the deploy tool:**
   - **API token (recommended):** cPanel → Security → **Manage API Tokens**
     → Create, then copy the token.
   - **Password:** works only without two-factor authentication.
   - **FTP:** an FTP account whose folder includes `thobe-world`.
     `FTP_HOST` can be the server's IP address. The connection stays
     encrypted: the first `npm run deploy:check` prints the name on the
     server's certificate as a line to add (`FTP_TLS_SERVERNAME=…`).
4. Copy `.deploy.env.example` to `.deploy.env` and fill it in, then run:
   ```bash
   npm run deploy:check
   ```
   Then run `npm run deploy`. Before the first deploy the site shows a short
   maintenance page.
5. In H47 Pay → « Mon site web », enter `https://<your domain>` and the same
   `NEWSTORE_SYNC_KEY`.

Back up `~/thobe-world/data` with cPanel's backups. H47 Pay can also push
everything again.

## Where you can deploy from

| From | Method | Notes |
| --- | --- | --- |
| Your PC | `cpanel` (token) or `ftp` | Node 22, `npm install`, then `.deploy.env`. Works from Windows: the release is built for Linux. |
| A Claude cloud session | `cpanel` only | Only port 443 is reachable, so use `https://cpanel.<domain>`. The session's network must allow that host and your domain. The cPanel login is saved as a credential of the cloud environment, not in the repository. FTP is not possible there. |

## If something goes wrong

- **`npm run deploy:status`** shows the live release, whether it is a
  fallback, and the recent failures with their reason.
- **`logs/bootstrap.log`** in the application root (File Manager) shows the
  full error from the server.
- **The site shows the maintenance page:** no release has started yet, or
  none could start. Deploy again, or roll back to a release listed by
  `deploy:status`.
- **A deploy stopped halfway** (your PC lost its connection): the next deploy
  says a lock is held. Run it again with `--force` after checking that no one
  else is deploying.
- **Photos show at full size and `/health` says `images: "original"`:** the
  host could not load the image library (a very old server). The shop still
  works; ask the host for a newer server (glibc 2.26 or later).
