import { HTTPException } from 'hono/http-exception'
import { readdirSync } from 'node:fs'
import { staticFolder } from '../paths'

export interface SlugPublication {
  slug: string
  files_id: number
  publication_id: string
  filename: string
  users_id: number
  expires: number | null
}

/** Only these explicitly authored errors may be returned to the caller. */
export class SlugError extends HTTPException {}

const reserved = new Set(['v1', 'stats', 'css', 'files', 'file', 'notes', ...readdirSync(staticFolder).map(name => name.split('.')[0].toLowerCase())])
export function validateSlug (slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(slug) || reserved.has(slug.toLowerCase())) {
    throw new SlugError(400, { message: 'Invalid or reserved custom slug. Use 2-64 uppercase or lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.' })
  }
}
