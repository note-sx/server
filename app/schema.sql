CREATE TABLE IF NOT EXISTS `api_keys`
(
    `id`        INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    `users_id`  INTEGER  NOT NULL,
    `api_key`   char(32) NOT NULL,
    `created`   INTEGER  NOT NULL DEFAULT (unixepoch()),
    `validated` INTEGER           DEFAULT NULL,
    `revoked`   INTEGER           DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS `files`
(
    `id`        INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    `users_id`  INTEGER  NOT NULL,
    `filename`  char(32) NOT NULL,
    `filetype`  TEXT     NOT NULL,
    `bytes`     INTEGER           DEFAULT NULL,
    `encrypted` tinyINTEGER       DEFAULT NULL,
    `hash`      TEXT              DEFAULT NULL,
    `created`   INTEGER  NOT NULL DEFAULT (unixepoch()),
    `updated`   INTEGER  NOT NULL DEFAULT (unixepoch()),
    `expires`   INTEGER           DEFAULT NULL,
    `accessed`  INTEGER           DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS `logs`
(
    `id`       INTEGER      NOT NULL PRIMARY KEY AUTOINCREMENT,
    `date`     INTEGER      NOT NULL DEFAULT (unixepoch()),
    `endpoint` TEXT         NOT NULL,
    `version`  TEXT                  DEFAULT NULL,
    `status`   smallINTEGER NOT NULL,
    `users_id` INTEGER               DEFAULT NULL,
    `files_id` INTEGER               DEFAULT NULL,
    `data`     text
);

CREATE TABLE IF NOT EXISTS `users`
(
    `id`      INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    `uid`     char(32) NOT NULL,
    `created` INTEGER  NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_apikeys_api_key ON api_keys (api_key);
CREATE INDEX IF NOT EXISTS idx_apikeys_created ON api_keys (created);
CREATE INDEX IF NOT EXISTS idx_apikeys_validated ON api_keys (validated);
CREATE INDEX IF NOT EXISTS idx_apikeys_revoked ON api_keys (revoked);
CREATE INDEX IF NOT EXISTS idx_apikeys_users_id ON api_keys (users_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_files_filename_filetype ON files (filename, filetype);
CREATE INDEX IF NOT EXISTS idx_files_users_id ON files (users_id);
CREATE INDEX IF NOT EXISTS idx_files_filename ON files (filename);
CREATE INDEX IF NOT EXISTS idx_files_filetype ON files (filetype);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files (hash);
CREATE INDEX IF NOT EXISTS idx_files_bytes ON files (bytes);
CREATE INDEX IF NOT EXISTS idx_files_expires ON files (expires);
CREATE INDEX IF NOT EXISTS idx_files_created ON files (created);
CREATE INDEX IF NOT EXISTS idx_files_accessed ON files (accessed);

CREATE INDEX IF NOT EXISTS idx_logs_endpoint ON logs (endpoint);
CREATE INDEX IF NOT EXISTS idx_logs_status ON logs (status);
CREATE INDEX IF NOT EXISTS idx_logs_users_id ON logs (users_id);
CREATE INDEX IF NOT EXISTS idx_logs_files_id ON logs (files_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users (uid);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created);

CREATE TABLE IF NOT EXISTS `shares_daily`
(
    `date`          INTEGER NOT NULL PRIMARY KEY,
    `new_notes`     INTEGER NOT NULL DEFAULT 0,
    `updated_notes` INTEGER NOT NULL DEFAULT 0
);

-- Per-day Cloudflare zone analytics, snapshotted before CF ages them out.
-- `date` is the unix epoch of the day's start (UTC), matching shares_daily.
CREATE TABLE IF NOT EXISTS `cf_daily`
(
    `date`            INTEGER NOT NULL PRIMARY KEY,
    `requests`        INTEGER NOT NULL DEFAULT 0,
    `bytes`           INTEGER NOT NULL DEFAULT 0,
    `cached_requests` INTEGER NOT NULL DEFAULT 0,
    `cached_bytes`    INTEGER NOT NULL DEFAULT 0,
    `page_views`      INTEGER NOT NULL DEFAULT 0,
    `threats`         INTEGER NOT NULL DEFAULT 0,
    `uniques`         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `cf_country_daily`
(
    `date`     INTEGER NOT NULL,
    `country`  TEXT    NOT NULL,
    `requests` INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (`date`, `country`)
);

CREATE INDEX IF NOT EXISTS idx_cf_country_daily_date ON cf_country_daily (date);

-- Additive migration: existing notes keep their original filenames and URLs.
CREATE TABLE IF NOT EXISTS custom_slugs (
    slug TEXT NOT NULL PRIMARY KEY,
    files_id INTEGER NOT NULL UNIQUE,
    publication_id TEXT NOT NULL UNIQUE
);
