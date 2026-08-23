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
      return null
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
  db: D1Database
  table: string // Sanitised to [a-z_]
  row: Row

  constructor (db: D1Database, table: string) {
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
    const pragma = await this.db.prepare(`PRAGMA table_info(${this.table})`).all()
    const fields = pragma.results || []
    fields.forEach((field) => {
      const name = (field as { name: string }).name
      this.row[name] = null
    })
  }

  emptyRow () {
    const row: Row = {}
    this.fields.forEach(field => { row[field] = null })
    return row
  }

  set (params: QueryParams) {
    Object.entries(params).forEach(([key, value]) => {
      this.row[key] = value
    })
  }

  async load (params: QueryParams) {
    const query = queryBuilder(params)
    const row = await this.db
      .prepare(`SELECT *
                FROM ${this.table}
                WHERE ${query.selectQuery}
                LIMIT 1`)
      .bind(...query.binds)
      .first()

    this.row = (row as Row) || this.emptyRow()
  }

  async save () {
    if (this.row.id) {
      // We already have a row ID, so this is an update
      const row = Object.assign({}, this.row)
      // Remove the primary key from the fields to update
      delete row.id
      const query = queryBuilder(row)
      // noinspection SqlResolve
      const res = await this.db
        .prepare(`UPDATE ${this.table}
                  SET ${query.updateQuery}
                  WHERE id = ?`)
        .bind(...query.binds, this.row.id)
        .run()
      return !!res.meta.changes
    } else {
      // Create a new record
      const query = queryBuilder(this.row)
      const res = await this.db
        .prepare(`
            INSERT INTO ${this.table} ${query.fields}
            VALUES ${query.values}`)
        .bind(...query.binds)
        .run()

      // Get the newly inserted record and set back to the row variable
      if (res.meta.changes) {
        this.row.id = res.meta.last_row_id
        return true
      }
    }
    return false
  }
}

export default async function Mapper (db: D1Database, table: string) {
  const mapper = new MapperClass(db, table)
  await mapper.init()
  return mapper
}
