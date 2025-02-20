import { withJson } from './middleware'
import { Hono } from 'hono'
import db from '../Database'

export const router = new Hono()

interface ViewData {
  note: string
  files: string[]
}

router
  .post('/', withJson, (c) => {
    try {
      const view = c.get('content' as never) as ViewData
      if (!view.note || !Array.isArray(view.files)) {
        // Incoming data doesn't appear to contain anything
        return c.body('', 404)
      } else {
        // Check to see if there's any unusual data come through
        const check = '' + view.note + view.files.join('')
        if (check.match(/[^A-Za-z0-9.]/) != null) {
          // Some weird characters, just exit
          return c.body('', 404)
        }

        // Add the note to be tracked along with the files array
        view.files.push(view.note + '.html')

        // Update the accessed time for each file
        view.files.forEach((file: string) => {
          const parts = file.split('.')
          if (parts.length === 2) {
            db.prepare('UPDATE files SET accessed = unixepoch() WHERE filename = ? AND filetype = ?')
              .run(parts[0], parts[1])
          }
        })
      }
    } catch (e) {
      console.log(e)
    }
    return c.body('')
  })
