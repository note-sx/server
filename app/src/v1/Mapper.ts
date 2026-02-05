import { SQLite } from './Database'

/**
 * Converts a key => value object into '?' placeholders for safely binding
 * in a SQL query
 *
 * Returns:
 *
 * - query: field1=? AND field2=? AND ...
 * - fields: (field1, field2, ...)
 * - values: (?, ?, ...)
 * - binds: [value1, value2, ...]
 */

export function queryBuilder (params: QueryParams) {
  const filteredParams: QueryParams = {}
  const query = Object.entries(params)
    .map(([field, value]) => {
      // Sanitize field names to only allow [a-z_] characters
      const sanitizedField = field.replace(/[^a-z_]/g, '')
      if (sanitizedField) {
        filteredParams[sanitizedField] = value
        return sanitizedField + '=?'
      }
    })
    .filter(Boolean) // Remove null entries

  return {
    selectQuery: query.join(' AND '),
    updateQuery: query.join(', '),
    fields: '(' + Object.keys(filteredParams).join(', ') + ')',
    values: '(' + Object.keys(filteredParams).map(_ => '?').join(', ') + ')',
    binds: Object.values(filteredParams)
  }
}

export type Row = {
  [key: string]: any
}
export type QueryParams = {
  [key: string]: any
}

export class MapperClass {
  db: SQLite
  table: string // Sanitised to [a-z_]
  row: Row

  constructor (db: SQLite, table: string) {
    this.db = db
    this.row = {}
    this.table = table.replace(/[^a-z_]/g, '')
  }

  get fields () {
    return Object.keys(this.row)
  }

  get notFound () {
    return !this.row.id
  }

  get found () {
    return !!this.row.id
  }

  get id () {
    return this.row.id
  }

  async init () {
    const pragma = this.db.prepare(`PRAGMA table_info(${this.table})`).all()
    const fields = pragma || []
    // @ts-ignore
    fields.forEach((field: { [key: string]: string }) => {
      const name = field.name
      this.row[name] = null
    })
  }

  emptyRow () {
    const row: Row = {}
    this.fields.forEach(field => row[field] = null)
    return row
  }

  set (params: QueryParams) {
    Object.entries(params).forEach(([key, value]) => {
      this.row[key] = value
    })
  }

  async load (params: QueryParams) {
    const query = queryBuilder(params)
    let row = this.db
      .prepare(`SELECT *
                FROM ${this.table}
                WHERE ${query.selectQuery}
                LIMIT 1`)
      .get(...query.binds)

    if (!row) {
      // Create a blank user if no record found
      row = this.emptyRow()
    }

    this.row = row as Row
  }

  save () {
    if (this.row.id) {
      // We already have a row ID, so this is an update
      const row = Object.assign({}, this.row)
      // Remove the primary key from the fields to update
      delete row.id
      const query = queryBuilder(row)
      // noinspection SqlResolve
      const res = this.db
        .prepare(`UPDATE ${this.table}
                  SET ${query.updateQuery}
                  WHERE id = ?`)
        .run(...query.binds, this.row.id)
      return !!res.changes
    } else {
      // Create a new record
      const query = queryBuilder(this.row)
      const res = this.db
        .prepare(`
            INSERT INTO ${this.table} ${query.fields}
            VALUES ${query.values}`)
        .run(...query.binds)

      // Get the newly inserted record and set back to the row variable
      if (res.changes) {
        this.row.id = res.lastInsertRowid
        return true
      }
    }
    return false
  }
}

export default async function Mapper (db: SQLite, table: string) {
  const mapper = new MapperClass(db, table)
  await mapper.init()
  return mapper
}
