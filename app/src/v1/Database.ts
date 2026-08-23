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

export type TableRow<T extends keyof DatabaseSchema> = DatabaseSchema[T]
