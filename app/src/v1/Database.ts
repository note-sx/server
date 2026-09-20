import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { databaseFile, schemaFile, tmpFolder } from '../paths'

interface DatabaseSchema {
  users: {
    id: number;
    uid: string;
    created: string;
  };
  files: {
    id: number;
    users_id: number;
    filename: string;
    filetype: string;
    bytes: number | null;
    encrypted: number | null;
    hash: string | null;
    remote_id: string | null;
    created: string;
    updated: string;
    expires: string | null;
  };
  apiKeys: {
    id: number;
    user_id: number;
    api_key: string;
    created: string;
    validated: string | null;
    revoked: string | null;
  };
  cf_daily: {
    date: number;
    requests: number;
    bytes: number;
    cached_requests: number;
    cached_bytes: number;
    page_views: number;
    threats: number;
    uniques: number;
  };
  cf_country_daily: {
    date: number;
    country: string;
    requests: number;
  };
}

export function now () {
  return dateToSqlite(new Date())
}

export function dateToSqlite (date: Date) {
  return Math.floor(date.getTime() / 1000)
}

export function epochToDate (sqliteDate: number) {
  return new Date(sqliteDate * 1000)
}

/*
  VACUUM copies the whole database into a scratch file before overwriting the
  original, and SQLite looks for somewhere to put it in SQLITE_TMPDIR, TMPDIR,
  /var/tmp, /usr/tmp, /tmp and finally the working directory. On a container
  with a read-only root every one of those fails, so point SQLite at the db
  volume, which is writable by definition. Failure to create the folder is left
  to /v1/ping to report rather than crashing the server on boot.
*/
if (!process.env.SQLITE_TMPDIR) {
  try {
    fs.mkdirSync(tmpFolder, { recursive: true })
    process.env.SQLITE_TMPDIR = tmpFolder
  } catch (e) {
    console.error('Could not create the SQLite scratch folder', e)
  }
}

export type TableRow<T extends keyof DatabaseSchema> = DatabaseSchema[T]
const db = new Database(databaseFile)
db.pragma('journal_mode = WAL')

// Set up the tables
const migration = fs.readFileSync(schemaFile, 'utf8')
db.exec(migration)

// One-shot backfill of `shares_daily` from existing notes so the historical
// chart isn't empty on launch. Only runs if the table is empty.
if (!db.prepare('SELECT 1 FROM shares_daily LIMIT 1').get()) {
  db.exec(`
    INSERT INTO shares_daily (date, new_notes)
    SELECT unixepoch(date(created, 'unixepoch')) AS day, COUNT(*)
    FROM files
    WHERE filetype = 'html'
    GROUP BY day
    ON CONFLICT(date) DO NOTHING
  `)
}

export type { Database as SQLite } from 'better-sqlite3'
export default db
