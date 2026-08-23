import { TableRow } from './Database'
import { Paths } from './File'
import { App } from '../types'
import { Stats } from './Stats'

export class Cron {
  app: App
  paths: Paths
  stats: Stats

  constructor (app: App) {
    this.app = app
    this.paths = new Paths(app)
    this.stats = new Stats(app)
  }

  /**
   * Dispatch a Workers Cron Trigger event to the matching job, keyed on the
   * cron expression configured in wrangler.toml's [triggers].crons.
   */
  async run (cronExpression: string) {
    switch (cronExpression) {
      case '* * * * *':
        // Delete expired files
        await this.deleteExpiredFiles()
        break
      case '0 * * * *':
        // Backfill CF history on first run (no-op once cf_daily has rows),
        // then refresh the public stats snapshot
        await this.stats.backfillIfEmpty()
        await this.stats.refresh()
        break
      case '30 0 * * *':
        // Snapshot the previous complete day's Cloudflare analytics into our
        // own DB (CF has finalised it by 00:30 UTC) so we keep them beyond
        // CF's retention.
        await this.stats.ingestYesterday()
        break
      default:
        console.log('No cron job registered for expression: ' + cronExpression)
    }
  }

  async deleteExpiredFiles () {
    const { results } = await this.app.db
      .prepare('SELECT * FROM files WHERE expires IS NOT NULL AND expires < unixepoch()')
      .all()

    for (const row of (results || [])) {
      const file = row as unknown as TableRow<'files'>

      // Delete the file
      try {
        await this.app.files.delete(this.paths.r2Key(file.filename, file.filetype))
      } catch {
      }

      // Clear from Cloudflare cache
      const url = this.paths.displayUrl(file.filename, file.filetype)
      await this.app.cloudflare.purgeCache([url])

      // Finally, delete the reference from our DB
      await this.app.db
        .prepare('DELETE FROM files WHERE id = ?')
        .bind(file.id)
        .run()

      console.log('Deleted expired file ' + url)
    }
  }
}
