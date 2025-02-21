import { createMiddleware } from 'hono/factory'
import { sha256 } from '../helpers'
import { HTTPException } from 'hono/http-exception'
import { appInstance } from '../../index'
import { TableRow } from '../Database'
import { ContentfulStatusCode } from 'hono/dist/types/utils/http-status'

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

  // Check the user
  const user = appInstance.db
    .prepare('SELECT * FROM users WHERE uid = ? LIMIT 1')
    .get(uid) as TableRow<'users'>

  if (!user) {
    throw new HTTPException(statusCode) // Unauthorised
  }

  // Get the stored API key
  const apiKey = appInstance.db
    .prepare('SELECT * FROM api_keys WHERE users_id = ? AND revoked IS NULL LIMIT 1')
    .get(user.id) as TableRow<'apiKeys'>
  if (!apiKey) {
    throw new HTTPException(statusCode) // Unauthorised
  }

  // Hash the stored key with the nonce, and compare to the provided hash
  const checkHash = await sha256('' + nonce + apiKey.api_key)
  if (checkHash !== userHash.toLowerCase()) {
    throw new HTTPException(462 as ContentfulStatusCode) // Automatically request new API key
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
  let allowedSize = 5 // Default (MB) unless specified
  const x = c.get('content')
  const filetype = x?.filetype || ''
  /* switch (filetype) {
    case 'html':
      allowedSize = 1;
      break;
    case 'css':
      allowedSize = 5;
      break;
    case 'gif':
      allowedSize = 1.5;
      break;
  } */
  const bytes = x?.byteLength || Infinity
  if (bytes > allowedSize * 1024 * 1024) {
    throw new HTTPException(413, {
      message: `Uploaded ${filetype.toUpperCase()} file size is too large. Please consider resizing, or hosting any large images on Imgur and linking back into your note.`
    }) // Filesize too large
  }
  await next()
})
