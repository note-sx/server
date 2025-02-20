import { Context } from 'hono'
import db from './Database'

type LogEvent = {
  status: number; // HTTP status
  endpoint?: string;
  version?: string | null;
  users_id?: number;
  files_id?: number;
  data?: any;
}

export function jsonErrorReplacer (_: string, value: any) {
  if (value instanceof Error) {
    return {
      // Pull all enumerable properties, supporting properties on custom Errors
      ...value,
      // Explicitly pull Error's non-enumerable properties
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }
  return value
}

export class Log {
  event (context: Context, event: LogEvent) {
    // Format the data value correctly
    let data = null
    if (event.data) {
      if (['string', 'number'].includes(typeof event.data)) {
        // String or number is inserted verbatim
        data = event.data
      } else {
        // Otherwise convert to JSON
        data = JSON.stringify(event.data, jsonErrorReplacer, 1)
      }
    }
    if (data === '{}') data = null // Final check for empty object

    const user = context.get('user')
    const file = context.get('file')
    db
      .prepare('INSERT INTO logs (endpoint, version, status, users_id, files_id, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        event.endpoint || context.req.url.match(/^https?:\/\/[^/]+(.+?)(\?|$)/)?.[1] || '',
        event.version || context.req.header('x-sharenote-version') || null,
        event.status || 0,
        event.users_id || user?.row?.id || null,
        event.files_id || file?.row?.id || null,
        data
      )
  }
}

export default new Log()
