import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { App, StatusCodes } from './types'
import db from './v1/Database'
import Cloudflare from './v1/Cloudflare'
import log from './v1/Log'
import { router as fileRouter } from './v1/routes/file'
import { router as accountRouter } from './v1/routes/account'
import { router as viewRouter } from './v1/routes/view'
import { HTTPException } from 'hono/http-exception'
import { Cron } from './v1/Cron'

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
app.route('/v1/view', viewRouter)
app.get('/v1/ping', () => new Response('ok'))

// Add etags for all files
app.use('*', etag())

// Rewrite note paths to the full HTML file
app.get(
  '/:filename{^\\w{' + Math.max(1, appInstance.folderPrefix) + ',}$}',
  serveStatic({
    root: '../userfiles/notes',
    rewriteRequestPath: (path) => {
      const length = appInstance.folderPrefix
      const subdir = length ? '/' + path.replace(/^\/?/, '').substring(0, length) : ''
      return subdir + path + '.html'
    }
  })
)
app.use('/css/*', serveStatic({ root: '../userfiles' }))
app.use('/files/*', serveStatic({ root: '../userfiles' }))

// Rewrite legacy hosting paths
// Only the main share.note.sx server needs these
if (process.env.LEGACY_PATHS) {
  app.get(
      '/file/notesx/*',
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
  const status = typeof err?.status === 'number' ? err.status : 500
  log.event(c, {
    status,
    endpoint: c.req.path
  })
  console.log(new Date().toISOString() + ': Error ' + err.status + ' on ' + c.req.url)

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
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully shutting down...')
  db.close()
  process.exit(0)
})

new Cron(appInstance)

serve(app)
