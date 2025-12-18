import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Options as HonoNodeServerOptions } from '@hono/node-server/dist/types'
import { serveStatic } from '@hono/node-server/serve-static'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { App, serverError, ServerErrors, StatusCodes } from './types'
import db from './v1/Database'
import Cloudflare from './v1/Cloudflare'
import log from './v1/Log'
import { router as fileRouter } from './v1/routes/file'
import { router as accountRouter } from './v1/routes/account'
import { HTTPException } from 'hono/http-exception'
import { Cron } from './v1/Cron'
import { trackView } from './v1/routes/middleware'
import fs from 'fs'

require('dotenv').config()

export const appInstance: App = {
  db,
  log,
  cloudflare: new Cloudflare(),
  baseFolder: __dirname.replace(/\/?app\/[^/]+\/?$/, ''),
  baseWebUrl: process.env.BASE_WEB_URL?.replace(/\/*$/, '') || '',
  hashSalt: process.env.HASH_SALT || '',
  folderPrefix: parseInt(process.env.FOLDER_PREFIX || '0', 10)
}

const app = new Hono()

// Routes
app.use('/v1/*', cors()) // CORS for all API routes
app.route('/v1/file', fileRouter)
app.route('/v1/account', accountRouter)
app.get('/v1/ping', async () => {
  try {
    // Check to make sure the upload location exists and is writeable
    await fs.promises.access(appInstance.baseFolder, fs.constants.W_OK)
    return new Response('ok')
  } catch (e) {
    console.log(e)
    return new Response('', { status: serverError(ServerErrors.FILESYSTEM_NOT_WRITABLE) })
  }
})

// Add etags for all files
app.use('*', etag())

// Rewrite note paths to the full HTML file
app.get(
  '/:filename{^\\w{' + Math.max(1, appInstance.folderPrefix) + ',}$}',
  trackView,
  serveStatic({
    root: '../userfiles/notes',
    rewriteRequestPath: (path) => {
      const length = appInstance.folderPrefix
      const subdir = length ? '/' + path.replace(/^\/?/, '').substring(0, length) : ''
      return subdir + path + '.html'
    }
  })
)
app.use('/css/*', trackView, serveStatic({ root: '../userfiles' }))
app.use('/files/*', trackView, serveStatic({ root: '../userfiles' }))

// Rewrite legacy hosting paths
// Only the main share.note.sx server needs these
if (process.env.LEGACY_PATHS) {
  app.get(
    '/file/notesx/*',
    trackView,
    serveStatic({
      root: '..',
      rewriteRequestPath: (path) => {
        const match = path.match(/^\/file\/notesx\/(css|files)\/([a-z0-9.]+)$/)
        if (match) {
          // User files
          const length = appInstance.folderPrefix
          const subdir = length ? match[2].substring(0, length) + '/' : ''
          return `/userfiles/${match[1]}/${subdir}${match[2]}`
        } else {
          // Static assets
          return '/app/static' + path.substring(12)
        }
      }
    })
  )
}

// Serve static files
app.use('*', serveStatic({ root: './static' }))

// 404 handler for unmatched routes
app.all('*', (c) => {
  return c.text('', 404)
})

app.onError((error, c) => {
  const err = error as HTTPException
  const status = err.status || 500
  log.event(c, {
    status,
    endpoint: c.req.path
  })
  log.console('Error ' + err.status + ' on ' + c.req.url)

  let userMessage = ''
  if (status === 500) {
    console.error(err)
  } else if ([460, 415, 413].includes(status)) {
    userMessage = err.message || ''
  } else {
    userMessage = StatusCodes[status] || ''
  }

  // Send the sanitised message back to the user
  return c.body('', status, { message: userMessage })
})

// Send the correct process error code for any uncaught exceptions (of which there should be none)
// so that Docker can gracefully restart the container
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err)
  db.close()
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  db.close()
  process.exit(1)
})
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully shutting down...')
  db.close()
  process.exit(0)
})

new Cron(appInstance)

const port = parseInt(process.env.PORT || '3000', 10)
const serverTimeout = parseInt(process.env.SERVER_TIMEOUT || '600000', 10) // Default 10 minutes

// Configure underlying Node server timeout via Hono node server Options
const serverOptions: HonoNodeServerOptions = {
  fetch: app.fetch,
  port,
  serverOptions: {
    // keep-alive idle connection timeout, corresponds to Keep-Alive: timeout=... header
    keepAliveTimeout: serverTimeout
  }
}

const server = serve(serverOptions)

// Manually set timeout options after creating server (compatible with different Node.js versions and type definitions)
// These options are available in Node.js 18+ but type definitions may be incomplete
if ('timeout' in server && typeof (server as any).timeout === 'number') {
  (server as any).timeout = serverTimeout
}
if ('requestTimeout' in server && typeof (server as any).requestTimeout === 'number') {
  (server as any).requestTimeout = serverTimeout
}
if ('headersTimeout' in server && typeof (server as any).headersTimeout === 'number') {
  (server as any).headersTimeout = serverTimeout
}
