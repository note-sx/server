import { Env, serverError, ServerErrors } from '../types'
import { HonoRequest } from 'hono'
import { HTTPException } from 'hono/http-exception'

// Top countries to keep per day, aligned with CF's per-query limit. Bounds
// cf_country_daily growth while keeping long-window roll-ups accurate.
const COUNTRY_SAMPLE_SIZE = 50

/** One finalised UTC day of zone analytics from `httpRequests1dGroups`. */
export type CfDayRow = {
  /** Unix epoch of the day's start (UTC). */
  date: number
  requests: number
  bytes: number
  cachedRequests: number
  cachedBytes: number
  pageViews: number
  threats: number
  uniques: number
  /** Top `COUNTRY_SAMPLE_SIZE` countries that day, by request count. */
  countries: { code: string, requests: number }[]
}

export default class Cloudflare {
  env: Env
  useTurnstile: boolean

  constructor (env: Env) {
    this.env = env
    this.useTurnstile = !!(env.CLOUDFLARE_TURNSTILE_KEY && env.CLOUDFLARE_TURNSTILE_SECRET)
  }

  /**
   * Fetch finalised daily zone analytics from the Cloudflare GraphQL API for
   * every complete UTC day in [since, until] inclusive. `httpRequests1dGroups`
   * retains roughly a year on the Free plan and caps a single query at ~52
   * weeks, so callers must keep the range within that window. Returns an empty
   * array if zone/API key is unconfigured or the request fails.
   */
  async getDailyAnalytics (since: Date, until: Date): Promise<CfDayRow[]> {
    const zone = this.env.CLOUDFLARE_ZONE_ID
    const key = this.env.CLOUDFLARE_API_KEY
    if (!zone || !key) return []

    const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
    const query = `
      query ($zoneTag: String!, $since: Date!, $until: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1dGroups(
              limit: 1000,
              filter: { date_geq: $since, date_leq: $until },
              orderBy: [date_ASC]
            ) {
              dimensions { date }
              sum {
                requests
                bytes
                cachedRequests
                cachedBytes
                pageViews
                threats
                countryMap { clientCountryName requests }
              }
              uniq { uniques }
            }
          }
        }
      }`

    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { zoneTag: zone, since: fmtDate(since), until: fmtDate(until) }
        })
      })
      const json = await res.json() as any
      if (Array.isArray(json?.errors) && json.errors.length) {
        console.error('Cloudflare GraphQL errors:', JSON.stringify(json.errors))
        return []
      }
      const groups = json?.data?.viewer?.zones?.[0]?.httpRequests1dGroups
      if (!groups) {
        console.error('Cloudflare GraphQL: no zone returned (check zone ID or token scope)')
        return []
      }

      return groups.map((g: any): CfDayRow => {
        const sum = g.sum || {}
        // countryMap order isn't guaranteed, so sort and cap it ourselves.
        const countries = ((sum.countryMap || []) as any[])
          .map(c => ({ code: (c.clientCountryName || 'XX').toUpperCase(), requests: c.requests || 0 }))
          .sort((a, b) => b.requests - a.requests)
          .slice(0, COUNTRY_SAMPLE_SIZE)
        return {
          date: Math.floor(Date.parse(g.dimensions.date + 'T00:00:00Z') / 1000),
          requests: sum.requests || 0,
          bytes: sum.bytes || 0,
          cachedRequests: sum.cachedRequests || 0,
          cachedBytes: sum.cachedBytes || 0,
          pageViews: sum.pageViews || 0,
          threats: sum.threats || 0,
          uniques: g.uniq?.uniques || 0,
          countries
        }
      })
    } catch (e) {
      console.error('Cloudflare analytics fetch failed:', e)
      return []
    }
  }

  async purgeCache (urls: string[]) {
    if (this.env.CLOUDFLARE_ZONE_ID && this.env.CLOUDFLARE_API_KEY) {
      // Purge the cache if this was a file upload
      await fetch(`https://api.cloudflare.com/client/v4/zones/${this.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.env.CLOUDFLARE_API_KEY,
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
      formData.append('secret', this.env.CLOUDFLARE_TURNSTILE_SECRET || '')
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
        <div class='cf-turnstile' data-sitekey='${this.env.CLOUDFLARE_TURNSTILE_KEY}' data-callback='postToken' data-theme='dark'></div>`

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
