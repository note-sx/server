# Share Note backend server

Backend server for [Share Note](https://github.com/alangrainger/share-note/).

## Change your Obsidian plugin to point to your server

Change the server URL in your `<VAULT_DIR>/.obsidian/plugins/share-note/data.json` file. Either reload the plugin or reload Obsidian for the changes to take effect.

This file will sync to all your devices using your normal sync method, so all your devices will update.

## Run with Docker

1. Take a copy of the [docker-compose.yml](https://github.com/note-sx/server/blob/main/docker-compose.yml) file
2. Take a copy of the [example env file](https://github.com/note-sx/server/blob/main/.env.example) and save as `.env`
3. Update the `.env` options as below
4. `docker-compose up -d`

The server writes only to the `db` and `userfiles` volumes, so the container can
run with a read-only root filesystem. `docker-compose.yml` has a commented-out
`read_only: true` line you can enable if you want that. No other configuration
is needed - SQLite keeps its scratch files in `db/tmp`.

## `.env` options

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
