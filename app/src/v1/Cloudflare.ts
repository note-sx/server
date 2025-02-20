import { serverError, ServerErrors } from '../types'
import { HonoRequest } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as process from 'node:process'

export default class Cloudflare {
  useTurnstile: boolean

  constructor () {
    this.useTurnstile = !!(process.env.CLOUDFLARE_TURNSTILE_KEY && process.env.CLOUDFLARE_TURNSTILE_SECRET)
  }

  async purgeCache (urls: string[]) {
    if (process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_API_KEY) {
      // Purge the cache if this was a file upload
      await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.CLOUDFLARE_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: urls
        })
      })
    }
  }

  async validateToken (request: HonoRequest) {
    try {
      const { searchParams } = new URL(request.url)
      const token = searchParams.get('token') || ''

      // Validate the token by calling the `/siteverify` API.
      const formData = new FormData()
      formData.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET || '')
      formData.append('response', token)
      formData.append('remoteip', request.header('CF-Connecting-IP') as string)

      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST'
      })
      const outcome = await result.json() as any
      if (outcome?.success === true) {
        return true
      }
    } catch (e) {
      console.log(e)
    }
    throw new HTTPException(serverError(ServerErrors.TURNSTILE_NO_VERIFY))
  }

  async showChallenge () {
    const head = `<script>function postToken(token){location.href+='&token='+encodeURIComponent(token)}</script>
        <script src='https://challenges.cloudflare.com/turnstile/v0/api.js' async defer></script>`
    const body = `<h3>Setting up Share Note plugin...</h3>
        <div class='cf-turnstile' data-sitekey='${process.env.CLOUDFLARE_TURNSTILE_KEY}' data-callback='postToken' data-theme='dark'></div>`

    return new Response(this.htmlResponse(head, body), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  htmlResponse (head = '', body = '') {
    return `
<!DOCTYPE html>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <title>Share Note for Obsidian</title>
  <link rel='stylesheet' href='https://cdn.jsdelivr.net/gh/kimeiga/bahunya/dist/bahunya.min.css'>
  ${head}
</head>
<body>
  <main role='main'>
    <section>
      ${body}
    </section>
  </main>
</body>
</html>
`
  }
}
