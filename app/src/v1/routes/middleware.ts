import { createMiddleware } from 'hono/factory'
import { sha256 } from '../helpers'
import { HTTPException } from 'hono/http-exception'
import { App, StatusCode } from '../../types'

export const withAuthenticatedUser = createMiddleware(async (c, next) => {
  // For some reason, some function is able to pass additional non-numeric data
  // instead of the 'statusCode'. So we check here and replace it if needed.
  // if (typeof statusCode !== 'number') statusCode = 401
  const statusCode = 401
  const uid = c.req.header('x-sharenote-id')
  const userHash = c.req.header('x-sharenote-key')
  const nonce = c.req.header('x-sharenote-nonce')

  if (!uid || !userHash || !nonce) {
    throw new HTTPException(statusCode) // Unauthorised
  }

  const app: App = c.get('app')

  // Check the user
  const user = await app.db
    .prepare('SELECT * FROM users WHERE uid = ? LIMIT 1')
    .bind(uid)
    .first()

  if (!user) {
    throw new HTTPException(statusCode) // Unauthorised
  }

  // Get the stored API key
  const apiKey = await app.db
    .prepare('SELECT * FROM api_keys WHERE users_id = ? AND revoked IS NULL LIMIT 1')
    .bind((user as { id: number }).id)
    .first()
  if (!apiKey) {
    throw new HTTPException(statusCode) // Unauthorised
  }

  // Hash the stored key with the nonce, and compare to the provided hash
  const checkHash = await sha256('' + nonce + (apiKey as { api_key: string }).api_key)
  if (checkHash !== userHash.toLowerCase()) {
    throw new HTTPException(462 as StatusCode) // Automatically request new API key
  }

  // Successful result, pass the user back into the Request object
  c.set('user', {
    row: user
  })

  await next()
})

/**
 * Take the values from the headers, and add them into the normal .content object
 */
export const withRawContent = createMiddleware(async (c, next) => {
  const base = 'x-sharenote-'
  const fileContents = await c.req.arrayBuffer()
  c.set('content', {
    // User headers are parsed in withAuthenticatedUser()
    hash: c.req.header(base + 'hash') || '',
    filetype: c.req.header(base + 'filetype') || '',
    content: fileContents,
    byteLength: fileContents.byteLength
  })
  await next()
})

export const withJson = createMiddleware(async (c, next) => {
  const text = await c.req.text()
  const content = JSON.parse(text)
  content.byteLength = text.length
  c.set('content', content)
  await next()
})

export const checkSize = createMiddleware(async (c, next) => {
  const app: App = c.get('app')
  const allowedSize = app.maximumUploadSizeMb || 5 // Default to 5MB if invalid config
  const x = c.get('content')
  const filetype = x?.filetype || ''
  const bytes = x?.byteLength || Infinity
  if (bytes > allowedSize * 1024 * 1024) {
    throw new HTTPException(413, {
      message: `Uploaded ${filetype.toUpperCase()} file size is too large. Please consider resizing, or hosting any large images on Imgur and linking back into your note.`
    }) // Filesize too large
  }
  await next()
})

/**
 * Track the last viewed time of notes and files
 */
export const trackView = createMiddleware(async (c, next) => {
  let filename, extension
  // Get the filename and extension from the path
  // The substring is to remove the leading slash
  const path = c.req.path.substring(1).split('/')
  if (path.length === 1) {
    // This is a file at the root, must be a note
    filename = path[0]
    extension = 'html'
  } else if (['css', 'files', 'file'].includes(path[0])) {
    // CSS or file attachment
    const match = path[path.length - 1].match(/^(\w+)\.(\w+)/)
    if (match && match.length >= 3) {
      filename = match[1]
      extension = match[2]
    }
  }

  // Finally, update the accessed column in the database
  if (filename && extension) {
    const app: App = c.get('app')
    await app.db
      .prepare('UPDATE files SET accessed = unixepoch() WHERE filename = ? AND filetype = ?')
      .bind(filename, extension)
      .run()
  }
  await next()
})
