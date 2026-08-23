# Share Note backend server

Backend server for [Share Note](https://github.com/alangrainger/share-note/), running as a
Cloudflare Worker (D1 + R2), self-hosted at `note.th33raphat.dev`.

## Change your Obsidian plugin to point to your server

Change the server URL in your `<VAULT_DIR>/.obsidian/plugins/share-note/data.json` file. Either reload the plugin or reload Obsidian for the changes to take effect.

This file will sync to all your devices using your normal sync method, so all your devices will update.

## Run on Cloudflare Workers

The app lives in `app/` and runs entirely on Cloudflare's platform:

- **D1** (`notesx-db`) for the `users` / `files` / `api_keys` / stats tables (see `app/schema.sql`)
- **R2** (`notesx-files`) for uploaded notes, CSS, attachments, and the generated stats snapshot
- **Cron Triggers** for the expired-file sweep, hourly stats refresh, and daily Cloudflare
  analytics ingest (replaces `node-cron`)
- **Workers Static Assets** for the favicons/manifest/MathJax assets in `app/static/`
- **`@resvg/resvg-wasm`** (+ a bundled DejaVu Sans font) to render the stats OG image, since the
  native `@resvg/resvg-js` build used by the Docker image doesn't run in the Workers isolate

### One-time setup

```sh
cd app
npm install
npx wrangler login                                   # Cloudflare OAuth
npx wrangler d1 create notesx-db                      # then paste the database_id into wrangler.toml
npx wrangler r2 bucket create notesx-files
npx wrangler d1 execute notesx-db --remote --file=schema.sql
npx wrangler secret put HASH_SALT                     # any random string, e.g. `openssl rand -hex 32`
```

`wrangler.toml` holds the non-secret config (`BASE_WEB_URL`, `FOLDER_PREFIX`,
`ALLOW_NEW_USERS`, `MAXIMUM_UPLOAD_SIZE_MB`, `FILENAME_LENGTH_HTML`) plus the D1/R2/Assets
bindings and the cron schedule. Optional secrets (only needed if you want Cloudflare-proxy cache
purging, analytics, or a Turnstile captcha on signup) are set the same way:

```sh
npx wrangler secret put CLOUDFLARE_API_KEY        # optional: cache purge + analytics ingest
npx wrangler secret put CLOUDFLARE_TURNSTILE_SECRET  # optional: captcha on account signup
```

(`CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_TURNSTILE_KEY` aren't secret - set them as `[vars]` in
`wrangler.toml` instead.)

For local development, copy the same secrets into a gitignored `.dev.vars` file (`KEY=value` per
line) and run:

```sh
npm run dev       # wrangler dev, local D1/R2 emulation
npm run dev -- --remote   # against the real remote D1/R2
```

### Deploy

```sh
npm run deploy     # wrangler deploy
```

The Worker is routed to `note.th33raphat.dev` via a zone Route in `wrangler.toml` (the hostname
was already proxied through Cloudflare, so a plain Route was used instead of a Workers Custom
Domain, which requires managing the DNS record itself).

### Known limitation

The stats page's PNG Open Graph image (`/stats/og-image.png`) is rendered with `resvg-wasm` and a
bundled DejaVu Sans font rather than the system fonts the Docker image had available - visually
equivalent, just a different font source.

## Legacy: Docker

The original Docker deployment (`Dockerfile` / `docker-compose.yml`, published by
`.github/workflows/ci.yaml`) still works if you'd rather run this on your own always-on host
instead of Cloudflare Workers:

1. Take a copy of the [docker-compose.yml](https://github.com/note-sx/server/blob/main/docker-compose.yml) file
2. Take a copy of the [example env file](https://github.com/note-sx/server/blob/main/.env.example) and save as `.env`
3. Update the `.env` options as below
4. `docker-compose up -d`

### `.env` options (Docker only)

| Option                      | Example             | Description                                                                                                                              |
|-----------------------------|---------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| BASE_WEB_URL                | https://example.com | The base public URL for your server.                                                                                                     |
| HASH_SALT                   | Any random string   |                                                                                                                                          |
| MAXIMUM_UPLOAD_SIZE_MB      | 5                   | The maximum allowed size for user uploads in megabytes (MB).                                                                             |
| FOLDER_PREFIX               | 0                   | *OPTIONAL.* Set this to `1` or `2` if you want user files to be split into subfolders based on the first *N* characters of the filename. |
| ALLOW_NEW_USERS             | true                | *OPTIONAL.* Set this to `false` to disable new user registration. Existing users can still generate new API keys.                        |
| FILENAME_LENGTH_HTML        | 8                   | *OPTIONAL.* Length of the random base36 filename for shared notes. Default `8`. Lower values shorten URLs but raise collision risk.      |
| CLOUDFLARE_TURNSTILE_KEY    |                     | *OPTIONAL.* If you want to use Turnstile to show a captcha when someone creates an account.                                              |
| CLOUDFLARE_TURNSTILE_SECRET |                     | *OPTIONAL.* If you want to use Turnstile to show a captcha when someone creates an account.                                              |
| CLOUDFLARE_ZONE_ID          |                     | *OPTIONAL.* If you want to use Cloudflare proxy in front of your server.                                                                 |
| CLOUDFLARE_API_KEY          |                     | *OPTIONAL.* If you want to use Cloudflare proxy in front of your server.                                                                 |
