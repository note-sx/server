import { Hono, Context } from 'hono'
import { cors } from 'hono/cors'
import { App, Env, serverError, ServerErrors, StatusCodes } from './types'
import Cloudflare from './v1/Cloudflare'
import log from './v1/Log'
import { router as fileRouter } from './v1/routes/file'
import { router as accountRouter } from './v1/routes/account'
import { HTTPException } from 'hono/http-exception'
import { Cron } from './v1/Cron'
import { Paths } from './v1/File'
import { trackView } from './v1/routes/middleware'
import statsHtmlTemplate from './v1/templates/stats.html'

type Variables = {
  app: App
  user: any
  content: any
  pluginVersion: any
  file: any
}

function buildApp (env: Env): App {
  return {
    db: env.DB,
    files: env.FILES,
    env,
    log,
    cloudflare: new Cloudflare(env),
    baseWebUrl: (env.BASE_WEB_URL || '').replace(/\/*$/, ''),
    hashSalt: env.HASH_SALT || '',
    folderPrefix: parseInt(env.FOLDER_PREFIX || '0', 10),
    allowNewUsers: env.ALLOW_NEW_USERS?.toLowerCase() !== 'false',
    filenameLengthHtml: parseInt(env.FILENAME_LENGTH_HTML || '8', 10),
    maximumUploadSizeMb: parseFloat(env.MAXIMUM_UPLOAD_SIZE_MB || '5')
  }
}

/** Serve an R2 object at the given key, or 404 if it doesn't exist. */
async function serveR2 (c: Context, key: string) {
  const app: App = c.get('app')
  const object = await app.files.get(key)
  if (!object) return c.text('', 404)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  return new Response(object.body, { headers })
}

const app = new Hono<{ Bindings: Env, Variables: Variables }>()

// Build the per-request App context from Workers bindings/vars
app.use('*', async (c, next) => {
  c.set('app', buildApp(c.env))
  await next()
})

// Routes
app.use('/v1/*', cors()) // CORS for all API routes
app.route('/v1/file', fileRouter)
app.route('/v1/account', accountRouter)
app.get('/v1/ping', async (c) => {
  try {
    const appCtx: App = c.get('app')
    await appCtx.db.prepare('SELECT 1').first()
    await appCtx.files.head('_healthcheck')
    return new Response('ok')
  } catch (e) {
    console.log(e)
    return new Response('', { status: serverError(ServerErrors.FILESYSTEM_NOT_WRITABLE) })
  }
})

// Public stats resources (must be registered before the note matcher below).
// Cached at the edge to match the refresh cron in Cron.ts.
const STATS_CACHE_SECONDS = 60 * 60 // 1 hour, matches the hourly stats cron
const oneHourCache = async (c: Context, next: () => Promise<void>) => {
  await next()
  c.header('Cache-Control', `public, max-age=${STATS_CACHE_SECONDS}`)
}
app.get('/stats', oneHourCache, (c) => {
  const appCtx: App = c.get('app')
  return c.html(statsHtmlTemplate.replace(/\{\{baseUrl\}\}/g, appCtx.baseWebUrl))
})
app.get('/stats.json', oneHourCache, (c) => serveR2(c, 'stats/stats.json'))
app.get('/stats/card.svg', oneHourCache, (c) => serveR2(c, 'stats/stats-card.svg'))
app.get('/stats/og-image.png', oneHourCache, (c) => serveR2(c, 'stats/stats-og.png'))

// Rewrite note paths to the full HTML file
app.get(
  '/:filename{^\\w{1,}$}',
  trackView,
  (c) => {
    const appCtx: App = c.get('app')
    const filename = c.req.param('filename')
    const folderPrefix = appCtx.folderPrefix
    if (filename.length < Math.max(1, folderPrefix)) return c.text('', 404)
    const key = new Paths(appCtx).r2Key(filename, 'html')
    return serveR2(c, key)
  }
)
app.use('/css/*', trackView, (c) => serveR2(c, c.req.path.substring(1)))
app.use('/files/*', trackView, (c) => serveR2(c, c.req.path.substring(1)))

// Rewrite legacy hosting paths
// Only the main share.note.sx server needs these
app.get('/file/notesx/*', trackView, async (c) => {
  const appCtx: App = c.get('app')
  if (!appCtx.env.LEGACY_PATHS) return c.text('', 404)
  const match = c.req.path.match(/^\/file\/notesx\/(css|files)\/([a-z0-9.]+)$/)
  if (!match) return c.text('', 404)
  const length = appCtx.folderPrefix
  const subdir = length ? match[2].substring(0, length) + '/' : ''
  return serveR2(c, `${match[1]}/${subdir}${match[2]}`)
})

// 404 handler for unmatched routes
app.all('*', (c) => {
  return c.text('', 404)
})

app.onError(async (error, c) => {
  const err = error as HTTPException
  const status = err.status || 500
  await log.event(c, {
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

async function scheduled (event: ScheduledEvent, env: Env) {
  const cron = new Cron(buildApp(env))
  await cron.run(event.cron)
}

export default {
  fetch: app.fetch,
  scheduled
}
