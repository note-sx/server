/*
  Filesystem layout, resolved once from this module's own location rather than
  from process.cwd(), so the paths hold wherever the server was started from.

  <baseFolder>/
    app/        this code, plus schema.sql and the static assets
    db/         sqlite database and its backup   (writable)
    userfiles/  uploaded notes, css and files    (writable)

  This module lives at the top of `src`, so __dirname is `<baseFolder>/app/src`
  under ts-node and `<baseFolder>/app/dist` once compiled. Keep it there.
*/

/** The install root: the folder holding `app`, `db` and `userfiles`. */
export const baseFolder = __dirname.replace(/\/?app\/[^/]+\/?$/, '')

/** The application folder, holding the code, the schema and the static assets. */
export const appFolder = `${baseFolder}/app`

/** SQLite database folder. Must be writable. */
export const dbFolder = `${baseFolder}/db`

/** Uploaded user content folder. Must be writable. */
export const userFilesFolder = `${baseFolder}/userfiles`

/**
 * The only folders the server writes to. Everything else, the application
 * itself included, can sit on a read-only filesystem.
 */
export const writableFolders = [dbFolder, userFilesFolder]

/** Static assets served at the web root. */
export const staticFolder = `${appFolder}/static`

/*
  The note templates are read from the `src` tree rather than `dist`, in both
  dev and production: tsc only emits .js from .ts, so the .html template and the
  decrypt scripts are never copied into the build output.
*/
export const templatesFolder = `${appFolder}/src/v1/templates`

/** Scratch space for SQLite, inside the db volume. See Database.ts. */
export const tmpFolder = `${dbFolder}/tmp`

export const databaseFile = `${dbFolder}/database.db`
export const databaseBackupFile = `${dbFolder}/backup.sqlite`
export const schemaFile = `${appFolder}/schema.sql`
export const statsTemplateFile = `${staticFolder}/stats.html`
