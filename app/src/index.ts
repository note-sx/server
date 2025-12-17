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

require('dotenv').config({ quiet: true })

export const appInstance: App = {
  db,
  log,
  cloudflare: new Cloudflare(),
  baseFolder: __dirname.replace(/\/?app\/[^/]+\/?$/, ''),
  baseWebUrl: process.env.BASE_WEB_URL?.replace(/\/*$/, '') || '',
  hashSalt: process.env.HASH_SALT || '',
  folderPrefix: parseInt(process.env.FOLDER_PREFIX || '0', 10),
  allowNewUsers: process.env.ALLOW_NEW_USERS?.toLowerCase() !== 'false',
  filenameLengthHtml: parseInt(process.env.FILENAME_LENGTH_HTML || '8', 10)
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

// Public stats resources (must be registered before the note matcher below).
// Cached at the edge to match the refresh cron in Cron.ts.
const STATS_CACHE_SECONDS = 60 * 60 // 1 hour, matches the hourly stats cron
const oneHourCache = async (c: any, next: any) => {
  await next()
  c.header('Cache-Control', `public, max-age=${STATS_CACHE_SECONDS}`)
}
let statsHtmlCache: string | null = null
const renderStatsHtml = () => {
  if (statsHtmlCache === null) {
    const tpl = fs.readFileSync('./static/stats.html', 'utf8')
    statsHtmlCache = tpl.replace(/\{\{baseUrl\}\}/g, appInstance.baseWebUrl)
  }
  return statsHtmlCache
}
app.get('/stats', oneHourCache, (c) => c.html(renderStatsHtml()))
app.get('/stats.json', oneHourCache, serveStatic({ root: '../userfiles' }))
app.get('/stats/card.svg', oneHourCache, serveStatic({
  root: '../userfiles',
  rewriteRequestPath: () => '/stats-card.svg'
}))
app.get('/stats/og-image.png', oneHourCache, serveStatic({
  root: '../userfiles',
  rewriteRequestPath: () => '/stats-og.png'
}))

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
const serverTimeout = parseInt(process.env.SERVER_TIMEOUT || '600000', 10) // default 10 minutes for large CSS

// Configure Node HTTP server timeouts via Hono node-server options.
const serverOptions: HonoNodeServerOptions = {
  fetch: app.fetch,
  port,
  serverOptions: {
    requestTimeout: serverTimeout,
    headersTimeout: serverTimeout,
    keepAliveTimeout: serverTimeout
  }
}

const server = serve(serverOptions, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
