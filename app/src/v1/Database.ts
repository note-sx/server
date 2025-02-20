import Database from 'better-sqlite3'
import * as fs from 'node:fs'

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
  }
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

export type TableRow<T extends keyof DatabaseSchema> = DatabaseSchema[T];
const db = new Database('../db/database.db')
db.pragma('journal_mode = WAL')

// Set up the tables
const migration = fs.readFileSync('schema.sql', 'utf8')
db.exec(migration)

export type { Database as SQLite } from 'better-sqlite3'
export default db
