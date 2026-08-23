import { App } from '../types'
import { CfDayRow } from './Cloudflare'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm'
import dejaVuSans from './fonts/DejaVuSans.ttf'
import dejaVuSansBold from './fonts/DejaVuSans-Bold.ttf'

const CHART_DAYS = 90
const CARD_CHART_DAYS = 30
const SECONDS_PER_DAY = 86400
const MS_PER_DAY = SECONDS_PER_DAY * 1000

// Window for the headline totals and country breakdown, in complete days.
const TOTALS_WINDOW_DAYS = 30
// Countries shown on the card (shares are of all sampled traffic in the window).
const TOP_COUNTRIES = 10
// First-run backfill depth. CF caps a single 1dGroups query at ~52 weeks; 360
// days leaves margin for the time-of-day component of that limit.
const BACKFILL_DAYS = 360

// cf_daily columns mapped to their CfDayRow source field, so the upsert SQL
// and its bound values are built from one list rather than repeated by hand.
const CF_DAILY_COLUMNS: { col: string, key: keyof CfDayRow }[] = [
  { col: 'requests', key: 'requests' },
  { col: 'bytes', key: 'bytes' },
  { col: 'cached_requests', key: 'cachedRequests' },
  { col: 'cached_bytes', key: 'cachedBytes' },
  { col: 'page_views', key: 'pageViews' },
  { col: 'threats', key: 'threats' },
  { col: 'uniques', key: 'uniques' }
]

type ShareRow = { date: number; new_notes: number; updated_notes: number }

type Payload = {
  updated: number
  headline: { requests: number; bytes: number; notes: number; runningSinceYear: number | null }
  shares: ShareRow[]
  countries: { code: string; share: number }[]
}

// The wasm module is instantiated once and reused for the lifetime of the
// isolate; concurrent callers within the same isolate share the same init
// promise so we never call initWasm() twice.
let wasmReady: Promise<void> | null = null
function ensureWasm (): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(wasmModule as WebAssembly.Module)
  return wasmReady
}

/**
 * Year from SERVICE_START_DATE (UTC). Returns null if the env var is missing
 * or unparseable, which the renderers use as the signal to hide the
 * "Running since" card entirely.
 */
function computeRunningSinceYear (app: App): number | null {
  const raw = app.env.SERVICE_START_DATE
  if (!raw) return null
  const start = new Date(raw)
  if (isNaN(start.getTime())) return null
  return start.getUTCFullYear()
}

/** Unix epoch (seconds) of the start of the most recent complete UTC day. */
function lastCompleteDayEpoch (): number {
  return Math.floor(Date.now() / MS_PER_DAY) * SECONDS_PER_DAY - SECONDS_PER_DAY
}

/** Earliest day (inclusive) of the TOTALS_WINDOW_DAYS-day headline window. */
function totalsWindowCutoff (): number {
  return lastCompleteDayEpoch() - (TOTALS_WINDOW_DAYS - 1) * SECONDS_PER_DAY
}

export class Stats {
  app: App

  constructor (app: App) {
    this.app = app
  }

  /**
   * On first run, backfill cf_daily from whatever CF still retains (~1 year)
   * so the stats start with history rather than a single day. No-op once the
   * table has any rows.
   */
  async backfillIfEmpty () {
    if (await this.app.db.prepare('SELECT 1 FROM cf_daily LIMIT 1').first()) return
    const lastFull = new Date(Date.now() - MS_PER_DAY)
    const since = new Date(Date.now() - BACKFILL_DAYS * MS_PER_DAY)
    const n = await this.ingest(since, lastFull)
    if (n) console.log(`Backfilled ${n} days of Cloudflare analytics`)
  }

  /** Ingest the most recent complete UTC day. Run daily, just after midnight. */
  async ingestYesterday () {
    const yesterday = new Date(Date.now() - MS_PER_DAY)
    if (await this.ingest(yesterday, yesterday)) await this.refresh()
  }

  /**
   * Snapshot every complete CF day in [since, until] into cf_daily and
   * cf_country_daily. Idempotent - re-running a day upserts in place - so both
   * the daily cron (one day) and the first-run backfill (a wide range) share it.
   * Returns the number of days written.
   */
  private async ingest (since: Date, until: Date): Promise<number> {
    const rows = await this.app.cloudflare.getDailyAnalytics(since, until)
    if (!rows.length) return 0

    const db = this.app.db
    const cols = CF_DAILY_COLUMNS.map(c => c.col)
    const dailyStmt = db.prepare(
      `INSERT INTO cf_daily (date, ${cols.join(', ')})
       VALUES (?, ${cols.map(() => '?').join(', ')})
       ON CONFLICT(date) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`
    )
    const countryStmt = db.prepare(
      `INSERT INTO cf_country_daily (date, country, requests) VALUES (?, ?, ?)
       ON CONFLICT(date, country) DO UPDATE SET requests = excluded.requests`
    )
    const batch: D1PreparedStatement[] = []
    for (const d of rows) {
      batch.push(dailyStmt.bind(d.date, ...CF_DAILY_COLUMNS.map(c => d[c.key] as number)))
      for (const c of d.countries) batch.push(countryStmt.bind(d.date, c.code, c.requests))
    }
    await db.batch(batch)
    return rows.length
  }

  async refresh () {
    try {
      const { notes } = await this.queryDb()
      const totals = await this.queryCfTotals()
      const payload: Payload = {
        updated: Math.floor(Date.now() / 1000),
        headline: {
          requests: totals.requests,
          bytes: totals.bytes,
          notes,
          runningSinceYear: computeRunningSinceYear(this.app)
        },
        shares: await this.queryShares(),
        countries: await this.queryCountries()
      }
      const svg = this.renderCard(payload)

      await ensureWasm()
      const ogPng = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: {
          fontBuffers: [new Uint8Array(dejaVuSans as ArrayBuffer), new Uint8Array(dejaVuSansBold as ArrayBuffer)],
          loadSystemFonts: false,
          defaultFontFamily: 'DejaVu Sans'
        }
      }).render().asPng()

      await Promise.all([
        this.app.files.put('stats/stats.json', JSON.stringify(payload), {
          httpMetadata: { contentType: 'application/json' }
        }),
        this.app.files.put('stats/stats-card.svg', svg, {
          httpMetadata: { contentType: 'image/svg+xml' }
        }),
        this.app.files.put('stats/stats-og.png', ogPng as Uint8Array, {
          httpMetadata: { contentType: 'image/png' }
        })
      ])
    } catch (e) {
      console.error('Stats refresh failed:', e)
    }
  }

  private async queryDb () {
    const row = await this.app.db.prepare(
      "SELECT COUNT(*) AS n FROM files WHERE filetype = 'html'"
    ).first<{ n: number }>()
    return { notes: row?.n || 0 }
  }

  private async queryShares (): Promise<ShareRow[]> {
    const cutoff = Math.floor(Date.now() / 1000) - CHART_DAYS * SECONDS_PER_DAY
    const { results } = await this.app.db.prepare(
      `SELECT date, new_notes, updated_notes FROM shares_daily
       WHERE date >= ? ORDER BY date ASC`
    ).bind(cutoff).all<ShareRow>()
    return results || []
  }

  /** Headline request/bandwidth totals over the last TOTALS_WINDOW_DAYS complete days. */
  private async queryCfTotals () {
    const row = await this.app.db.prepare(
      `SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(bytes), 0) AS bytes
       FROM cf_daily WHERE date >= ?`
    ).bind(totalsWindowCutoff()).first<{ requests: number; bytes: number }>()
    return row || { requests: 0, bytes: 0 }
  }

  /**
   * Top TOP_COUNTRIES countries by requests over the last TOTALS_WINDOW_DAYS
   * complete days. Shares are of all traffic in the window (so the top N can
   * sum to under 100%), matching the previous live behaviour.
   */
  private async queryCountries (): Promise<{ code: string; share: number }[]> {
    const cutoff = totalsWindowCutoff()
    const totalRow = await this.app.db.prepare(
      'SELECT COALESCE(SUM(requests), 0) AS total FROM cf_country_daily WHERE date >= ?'
    ).bind(cutoff).first<{ total: number }>()
    const total = totalRow?.total || 0
    const { results } = await this.app.db.prepare(
      `SELECT country, SUM(requests) AS requests FROM cf_country_daily
       WHERE date >= ? GROUP BY country ORDER BY requests DESC LIMIT ?`
    ).bind(cutoff, TOP_COUNTRIES).all<{ country: string; requests: number }>()
    return (results || []).map(r => ({ code: r.country, share: total > 0 ? r.requests / total * 100 : 0 }))
  }

  /**
   * Render a README-embeddable SVG card. Dark/light theming is handled by an
   * embedded prefers-color-scheme media query, which GitHub's image proxy
   * preserves. No external resources, no scripts (would be stripped anyway).
   */
  private renderCard (p: Payload): string {
    const W = 600
    const H = 315
    const PAD = 22

    // Stat-card geometry (cardW depends on stats.length and is computed below)
    const labelY = 110
    const valueY = 142
    const footY = 160

    // Sparkline geometry
    const sparkLabelY = 200
    const sparkY = 210
    const sparkH = 90
    const sparkW = W - PAD * 2
    const sparkBottom = sparkY + sparkH

    // Build a value-per-day array for the last CARD_CHART_DAYS complete days,
    // oldest first. Today is excluded because it's still in progress and would
    // otherwise render as a sharp drop on the right edge of the line.
    const lastFullDay = lastCompleteDayEpoch()
    const values = new Array(CARD_CHART_DAYS).fill(0) as number[]
    for (const r of p.shares) {
      const daysBack = Math.round((lastFullDay - r.date) / SECONDS_PER_DAY)
      if (daysBack < 0 || daysBack >= CARD_CHART_DAYS) continue
      values[CARD_CHART_DAYS - 1 - daysBack] = r.new_notes + r.updated_notes
    }
    const maxValue = Math.max(...values)
    const yScale = maxValue > 0 ? sparkH / maxValue : 0
    const points = values.map((v, i) => ({
      x: PAD + (i / Math.max(1, CARD_CHART_DAYS - 1)) * sparkW,
      y: sparkBottom - v * yScale
    }))

    const linePath = smoothPath(points)
    const areaPath = linePath
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)},${sparkBottom} L ${points[0].x.toFixed(1)},${sparkBottom} Z`
      : ''
    const chart = linePath
      ? `<path d="${areaPath}" class="area"/><path d="${linePath}" class="line"/>`
      : ''
    const maxLabel = maxValue > 0
      ? `<text x="${W - PAD}" y="${sparkLabelY}" class="muted" font-size="11" text-anchor="end">max ${fmtNumber(maxValue)}</text>`
      : ''

    const stats: { label: string; value: string; foot?: string }[] = [
      { label: 'REQUESTS', value: fmtNumber(p.headline.requests), foot: '30 days' },
      { label: 'BANDWIDTH', value: fmtBytes(p.headline.bytes), foot: '30 days' },
      { label: 'SHARED NOTES', value: fmtNumber(p.headline.notes), foot: 'all time' }
    ]
    if (p.headline.runningSinceYear !== null) {
      stats.push({ label: 'RUNNING SINCE', value: String(p.headline.runningSinceYear), foot: 'and still free!' })
    }
    const cardW = (W - PAD * 2) / stats.length
    const statCards = stats.map((s, i) => {
      const x = PAD + i * cardW
      let out = `<text x="${x}" y="${labelY}" class="muted" font-size="12" font-weight="600" letter-spacing="0.6">${s.label}</text>` +
                `<text x="${x}" y="${valueY}" class="text" font-size="26" font-weight="700">${escapeXml(s.value)}</text>`
      if (s.foot) {
        out += `<text x="${x}" y="${footY}" class="muted" font-size="11">${s.foot}</text>`
      }
      return out
    }).join('')

    const updatedStr = new Date(p.updated * 1000).toISOString().slice(0, 10)

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share Note stats">
  <style>
    .bg { fill: #ffffff; stroke: #e5e5e5; }
    .text { fill: #1a1a1a; }
    .muted { fill: #6a6a6a; }
    .accent { fill: #5b6cff; }
    .accent-soft { fill: #c5cdff; }
    .line { fill: none; stroke: #5b6cff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: #5b6cff; opacity: 0.18; }
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #18181b; stroke: #2a2a2e; }
      .text { fill: #f2f2f2; }
      .muted { fill: #9a9aa3; }
      .accent { fill: #8b9bff; }
      .accent-soft { fill: #3a467d; }
      .line { stroke: #8b9bff; }
      .area { fill: #8b9bff; }
    }
  </style>
  <rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
  <text x="${PAD}" y="${PAD + 20}" class="text" font-size="22" font-weight="700">Server stats</text>
  <text x="${PAD}" y="${PAD + 40}" class="muted" font-size="13">Updated ${updatedStr}</text>
  ${statCards}
  <text x="${PAD}" y="${sparkLabelY}" class="muted" font-size="12" font-weight="600">Shares per day · last ${CARD_CHART_DAYS} days</text>
  ${maxLabel}
  ${chart}
</svg>`
  }
}

function fmtNumber (n: number): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K'
  return n.toLocaleString('en-US')
}

function fmtBytes (n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i]
}

function escapeXml (s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/**
 * Cardinal-spline (Catmull-Rom variant) smoothing through the given points.
 * Tension 0.2 is mild; less prone to overshoot than the classic 0.5 form,
 * which matters here because we don't want the line dipping below the
 * baseline at valleys in the data.
 */
function smoothPath (pts: { x: number, y: number }[]): string {
  if (pts.length < 2) return ''
  const k = 0.2
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) * k
    const c1y = p1.y + (p2.y - p0.y) * k
    const c2x = p2.x - (p3.x - p1.x) * k
    const c2y = p2.y - (p3.y - p1.y) * k
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}
